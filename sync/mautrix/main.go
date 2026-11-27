// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/rs/zerolog"
	"go.mau.fi/mautrix-twitter/pkg/juiceboxgo"
	"go.mau.fi/mautrix-twitter/pkg/twittermeow"
	"go.mau.fi/mautrix-twitter/pkg/twittermeow/cookies"
	"go.mau.fi/mautrix-twitter/pkg/twittermeow/crypto"
	"go.mau.fi/mautrix-twitter/pkg/twittermeow/data/payload"
	"go.mau.fi/mautrix-twitter/pkg/twittermeow/data/response"
	"go.mau.fi/mautrix-twitter/pkg/twittermeow/data/types"
)

type request struct {
	ID           string               `json:"id"`
	Method       string               `json:"method"`
	Cookies      map[string]string    `json:"cookies"`
	PIN          string               `json:"pin"`
	Conversation string               `json:"conversation"`
	Cursor       string               `json:"cursor"`
	InboxCursor  *payload.XChatCursor `json:"inboxCursor"`
	Text         string               `json:"text"`
	MessageID    string               `json:"messageId"`
	MediaHash    string               `json:"mediaHash"`
	KeyVersion   string               `json:"keyVersion"`
	OK           bool                 `json:"ok"`
}
type historicalKey struct{}

const historyMax = "9223372036854775807"

func historyVariables(conversation, cursor, keyVersion string) *payload.GetConversationPageQueryVariables {
	if cursor == "" {
		cursor = historyMax
	}
	if keyVersion == "" {
		keyVersion = historyMax
	}
	// X rejects the request when min_conversation_key_version is omitted.
	return payload.NewGetConversationPageQueryVariables(conversation, cursor, keyVersion, nil)
}

func historyEvents(conversation string, encoded []string) ([]*payload.MessageEvent, error) {
	events := make([]*payload.MessageEvent, 0, len(encoded))
	for _, raw := range encoded {
		evt, err := twittermeow.DecodeMessageEvent(raw)
		if err != nil {
			return nil, err
		}
		if evt.ConversationId == nil || *evt.ConversationId == "" {
			id := conversation
			evt.ConversationId = &id
		}
		if *evt.ConversationId != conversation {
			return nil, errors.New("history conversation mismatch")
		}
		if evt.SequenceId == nil || *evt.SequenceId == "" {
			return nil, errors.New("history sequence missing")
		}
		events = append(events, evt)
	}
	sort.SliceStable(events, func(i, j int) bool { return newer(*events[j].SequenceId, *events[i].SequenceId) })
	return events, nil
}

type boundedBuffer struct{ bytes.Buffer }

func (b *boundedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 25<<20 {
		return 0, errors.New("attachment too large")
	}
	return b.Buffer.Write(p)
}

type bridge struct {
	ctx              context.Context
	cancel           context.CancelFunc
	client           *twittermeow.Client
	keys             *memoryKeys
	output           io.Writer
	outputMu         sync.Mutex
	lifecycle        sync.Mutex
	ready            atomic.Bool
	eventCounter     atomic.Uint64
	acknowledgements sync.Map
}

// Inspect only known lifecycle messages. Never forward raw upstream logs,
// which may include message content, URLs, cookies, or key material.
type healthLog struct{ b *bridge }

func (l healthLog) Write(p []byte) (int, error) {
	var v struct {
		Message string `json:"message"`
	}
	_ = json.Unmarshal(p, &v)
	if v.Message == "XChat websocket disconnected, will reconnect" {
		l.b.ready.Store(false)
		l.b.emit(map[string]any{"event": "connection", "ready": false})
	}
	return len(p), nil
}
func (b *bridge) emit(v any) {
	b.outputMu.Lock()
	defer b.outputMu.Unlock()
	_ = json.NewEncoder(b.output).Encode(v)
}
func (b *bridge) event(ctx context.Context, evt types.TwitterEvent) bool {
	msg, ok := evt.(*types.Message)
	if !ok {
		if _, unsupported := evt.(*types.XChatUnsupportedMessage); unsupported {
			return false
		}
		return true
	}
	// The browser identifies XChat messages by UUID, while pagination uses the
	// numeric sequence. Keep both and use the UUID for the shared CRM identity.
	id := msg.RequestID
	if id == "" {
		id = msg.ID
	}
	if id == "" || msg.ConversationID == "" {
		return false
	}
	eventID := fmt.Sprint(b.eventCounter.Add(1))
	done := make(chan bool, 1)
	b.acknowledgements.Store(eventID, done)
	defer b.acknowledgements.Delete(eventID)
	b.emit(map[string]any{"event": "message", "eventId": eventID, "message": msg, "attachments": msg.MessageData.Attachments, "nativeId": id, "historical": ctx.Value(historicalKey{}) == true, "receivedAt": time.Now().UnixMilli()})
	select {
	case accepted := <-done:
		return accepted
	case <-ctx.Done():
		return false
	case <-time.After(30 * time.Second):
		return false
	}
}
func (b *bridge) fail(id, code, stage string, uncertain bool) {
	b.emit(map[string]any{"id": id, "error": map[string]any{"code": code, "stage": stage, "uncertain": uncertain}})
}
func errorCode(err error) string {
	var recovery *juiceboxgo.RecoverError
	if errors.As(err, &recovery) && recovery.GuessesRemaining != nil {
		if *recovery.GuessesRemaining == 0 {
			return "pin_locked"
		}
		return "incorrect_pin"
	}
	if strings.Contains(strings.ToLower(err.Error()), "invalid pin") {
		return "incorrect_pin"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	s := strings.ToLower(err.Error())
	switch {
	case strings.Contains(s, "429"), strings.Contains(s, "rate limit"):
		return "rate_limited"
	case strings.Contains(s, "403"):
		return "access_blocked"
	case strings.Contains(s, "401"), strings.Contains(s, "unauthorized"):
		return "login_required"
	case strings.Contains(s, "locked"), strings.Contains(s, "guesses"):
		return "pin_locked"
	}
	return "connector_error"
}
func (b *bridge) unlock(ctx context.Context, pin string) error {
	data, err := b.client.GetPublicKeys(ctx, []string{b.client.GetCurrentUserID()})
	if err != nil {
		return err
	}
	var candidates []response.PublicKeyWithTokenMap
	for _, user := range data.Data.UserResultsByRestIDs {
		for _, key := range user.Result.GetPublicKeys.PublicKeysWithTokenMap {
			if key.TokenMap.KeyStoreTokenMapJSON != "" && len(key.TokenMap.TokenMap) > 0 {
				candidates = append(candidates, key)
			}
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		return newer(candidates[i].PublicKeyWithMetadata.Version, candidates[j].PublicKeyWithMetadata.Version)
	})
	var selected *response.PublicKeyWithTokenMap
	var recovery *juiceboxgo.Client
	for _, candidate := range candidates {
		config, configErr := juiceboxgo.ConfigurationFromJSON(candidate.TokenMap.KeyStoreTokenMapJSON)
		if configErr != nil {
			return configErr
		}
		tokens := map[string]juiceboxgo.AuthToken{}
		for _, entry := range candidate.TokenMap.TokenMap {
			tokens[strings.ToLower(strings.TrimSpace(entry.Key))] = juiceboxgo.AuthToken(strings.TrimSpace(entry.Value.Token))
		}
		client, clientErr := juiceboxgo.NewClient(config, tokens, b.client.HTTP, zerolog.Nop())
		if clientErr != nil {
			return clientErr
		}
		registrationErr := client.CheckRegistration(ctx)
		if errors.Is(registrationErr, juiceboxgo.ErrNotRegistered) {
			client.Close()
			continue
		}
		if registrationErr != nil {
			client.Close()
			return registrationErr
		}
		selected = &candidate
		recovery = client
		break
	}
	if selected == nil || recovery == nil {
		return errors.New("no registered PIN-backed key")
	}
	defer recovery.Close()
	secret, err := recovery.Recover(ctx, []byte(pin), nil)
	if err != nil {
		return err
	}
	defer clear(secret)
	var keys struct {
		Secret  string `json:"secret_key"`
		Signing string `json:"signing_key"`
	}
	if len(secret) > 0 && secret[0] == '{' {
		if err = json.Unmarshal(secret, &keys); err != nil {
			return err
		}
	} else if len(secret) == 64 {
		keys.Secret = base64.StdEncoding.EncodeToString(secret[:32])
		keys.Signing = base64.StdEncoding.EncodeToString(secret[32:])
	} else {
		return errors.New("unsupported recovered key format")
	}
	own, err := crypto.LoadSigningKeyPair(b.client.GetCurrentUserID(), selected.PublicKeyWithMetadata.Version, keys.Signing, keys.Secret)
	if err != nil {
		return err
	}
	return b.keys.PutOwnSigningKey(ctx, own)
}
func (b *bridge) processPage(ctx context.Context, page response.XChatInboxPage) error {
	if page.ErrorCode != "" || len(page.Errors) > 0 {
		return errors.New("inbox rejected")
	}
	processor := b.client.GetXChatProcessor()
	for _, item := range page.Items {
		if item.ConversationUnavailable {
			continue
		}
		if item.ConversationDetail.ConversationID == "" {
			return errors.New("inbox identity missing")
		}
		b.emit(map[string]any{"event": "conversation", "conversation": item.ConversationDetail})
		if err := processor.ProcessKeyChangeEvents(ctx, &item); err != nil {
			return err
		}
		// A zero boundary tells upstream to skip snapshot messages. Import the
		// bounded latest window now instead of waiting for its deep-history job.
		if err := processor.ProcessMessageAndReadEvents(ctx, &item, time.UnixMilli(1), ""); err != nil {
			return err
		}
	}
	return processor.ProcessEncodedMessageEvents(ctx, page.EncodedMessageEvents)
}
func (b *bridge) handle(r request) {
	ctx, cancel := context.WithTimeout(b.ctx, 45*time.Second)
	defer cancel()
	var result any
	var err error
	uncertain := false
	switch r.Method {
	case "start":
		b.lifecycle.Lock()
		defer b.lifecycle.Unlock()
		if b.client != nil {
			b.fail(r.ID, "already_started", "start", false)
			return
		}
		b.keys = newKeys()
		b.client = twittermeow.NewClient(cookies.NewCookies(r.Cookies), b.keys, zerolog.New(healthLog{b}).Level(zerolog.InfoLevel))
		b.client.SetXChatEventHandler(b.event)
		b.client.SetXChatConnectHandler(func(_ context.Context, _ twittermeow.XChatLiveDrain) error {
			b.ready.Store(true)
			b.emit(map[string]any{"event": "connection", "ready": true})
			return nil
		})
		var profile twittermeow.CurrentUserProfile
		profile, err = b.client.LoadMessagesPage(ctx)
		if err == nil {
			b.client.SetCurrentUserID(profile.ID)
			result = map[string]any{"userId": profile.ID, "name": profile.Name, "handle": profile.ScreenName}
		}
	case "unlock":
		b.lifecycle.Lock()
		defer b.lifecycle.Unlock()
		if b.client == nil {
			b.fail(r.ID, "not_started", "unlock", false)
			return
		}
		if len(r.PIN) != 4 {
			b.fail(r.ID, "invalid_pin", "unlock", false)
			return
		}
		if _, e := strconv.Atoi(r.PIN); e != nil {
			b.fail(r.ID, "invalid_pin", "unlock", false)
			return
		}
		err = b.unlock(ctx, r.PIN)
		r.PIN = ""
		if err == nil {
			// Start the live socket before any historical conversation scans. A
			// separate incremental inbox loop in the parent repairs reconnect gaps.
			socket := make(chan error, 1)
			go func() { socket <- b.client.StartXChatWebsocket(b.ctx) }()
			select {
			case err = <-socket:
			case <-ctx.Done():
				err = ctx.Err()
			}
			if err == nil {
				b.ready.Store(true)
				result = map[string]any{"ready": true}
			} else {
				b.client.Disconnect()
				b.ready.Store(false)
			}
		}
	case "inbox":
		if !b.ready.Load() {
			b.fail(r.ID, "not_ready", r.Method, false)
			return
		}
		var page response.XChatInboxPage
		if r.InboxCursor != nil {
			var data *response.GetInboxPageRequestQueryResponse
			data, err = b.client.GetInboxPageRequest(ctx, payload.NewInboxPageRequestQueryVariables(r.InboxCursor))
			if err == nil {
				page = data.Data.GetInboxPage
			}
		} else {
			var data *response.GetInitialXChatPageQueryResponse
			data, err = b.client.GetInitialXChatPage(ctx, payload.NewInitialXChatPageQueryVariables(r.Cursor))
			if err == nil {
				page = data.Data.GetInboxPage
			}
		}
		if err == nil {
			err = b.processPage(context.WithValue(ctx, historicalKey{}, true), page)
		}
		if err == nil {
			result = map[string]any{"cursor": page.InboxCursor, "maxSequence": page.MaxUserSequenceID, "messageCursor": page.MessageEventsCursor, "conversations": len(page.Items)}
		}
	case "conversation":
		if !b.ready.Load() {
			b.fail(r.ID, "not_ready", r.Method, false)
			return
		}
		var data *response.GetInboxPageConversationDataResponse
		data, err = b.client.GetConversationData(ctx, payload.NewInboxPageConversationDataQueryVariables(r.Conversation, false))
		if err == nil {
			var item response.XChatInboxItem
			item, err = data.Item(r.Conversation)
			if err == nil {
				result = item.ConversationDetail
			}
		}
	case "history":
		if !b.ready.Load() {
			b.fail(r.ID, "not_ready", r.Method, false)
			return
		}
		keyVersion := ""
		if key, e := b.keys.GetLatestConversationKey(ctx, r.Conversation); e == nil {
			keyVersion = key.KeyVersion
		}
		var data *response.GetConversationPageQueryResponse
		data, err = b.client.GetConversationPage(ctx, historyVariables(r.Conversation, r.Cursor, keyVersion))
		if err == nil {
			processor := b.client.GetXChatProcessor()
			historyCtx := context.WithValue(ctx, historicalKey{}, true)
			// Key-change events precede content and are never treated as messages.
			var keys, events []*payload.MessageEvent
			keys, err = historyEvents(r.Conversation, data.Data.GetConversationPage.MissingConversationKeyChangeEvents)
			if err == nil {
				events, err = historyEvents(r.Conversation, data.Data.GetConversationPage.EncodedMessageEvents)
			}
			next := ""
			if err == nil {
				for _, evt := range events {
					if evt.SequenceId != nil && (next == "" || newer(next, *evt.SequenceId)) {
						next = *evt.SequenceId
					}
				}
			}
			if err == nil {
				// Supplemental key events are not members of the paginated stream,
				// so they never move its cursor. Fill omitted conversation IDs only
				// from this exact request, and reject a conflicting identity.
				for _, evt := range append(keys, events...) {
					if evt.Detail != nil && evt.Detail.ConversationKeyChangeEvent != nil {
						if err = processor.ProcessMessage(historyCtx, &payload.Message{MessageEvent: evt}); err != nil {
							break
						}
					}
				}
			}
			if err == nil {
				for _, evt := range events {
					if evt.Detail != nil && evt.Detail.ConversationKeyChangeEvent != nil {
						continue
					}
					if err = processor.ProcessMessage(historyCtx, &payload.Message{MessageEvent: evt}); err != nil {
						break
					}
				}
			}
			if err == nil {
				result = map[string]any{"cursor": next, "hasMore": data.Data.GetConversationPage.HasMore, "count": len(data.Data.GetConversationPage.EncodedMessageEvents)}
			}
		}
	case "send":
		if !b.ready.Load() {
			b.fail(r.ID, "not_ready", r.Method, false)
			return
		}
		// Preparatory key retrieval is definitely pre-send. Once Send is invoked,
		// all unconfirmed errors are uncertain and must NEVER trigger a resend.
		err = b.client.RefreshConversationKeys(ctx, r.Conversation)
		if err == nil {
			uncertain = true
			var sent *response.SendMessageMutationResponse
			sent, err = b.client.SendEncryptedMessage(ctx, twittermeow.SendEncryptedMessageOpts{ConversationID: r.Conversation, MessageID: r.MessageID, Text: r.Text})
			if err == nil {
				var evt *payload.MessageEvent
				evt, err = twittermeow.DecodeSendMessageMutationMessageEvent(sent.Data.XChatSendCreateMessageEvent.EncodedMessageEvent)
				if err == nil && evt.MessageId != nil && evt.CreatedAtMsec != nil {
					result = map[string]any{"messageId": *evt.MessageId, "timestamp": *evt.CreatedAtMsec}
					uncertain = false
				} else if err == nil {
					err = errors.New("missing X send receipt")
				}
			}
		}
	case "media":
		if !b.ready.Load() || r.Conversation == "" || r.MediaHash == "" || strings.ContainsAny(r.Conversation+r.MediaHash, "/?#") {
			b.fail(r.ID, "invalid_media", "media", false)
			return
		}
		var content boundedBuffer
		_, err = b.client.DownloadXChatMedia(ctx, r.Conversation, r.MediaHash, r.KeyVersion, &content)
		if err == nil {
			result = map[string]any{"data": base64.StdEncoding.EncodeToString(content.Bytes()), "mime": http.DetectContentType(content.Bytes())}
		}
	default:
		b.fail(r.ID, "unsupported", r.Method, false)
		return
	}
	if err != nil {
		b.fail(r.ID, errorCode(err), r.Method, uncertain)
		return
	}
	b.emit(map[string]any{"id": r.ID, "result": result})
}
func run(input io.Reader, output io.Writer) {
	ctx, cancel := context.WithCancel(context.Background())
	b := &bridge{ctx: ctx, cancel: cancel, output: output}
	defer cancel()
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	for scanner.Scan() {
		var r request
		if json.Unmarshal(scanner.Bytes(), &r) != nil {
			continue
		}
		if r.Method == "ack" {
			if v, ok := b.acknowledgements.Load(r.ID); ok {
				select {
				case v.(chan bool) <- r.OK:
				default:
				}
			}
			continue
		}
		go b.handle(r)
	}
}
func main() { run(os.Stdin, os.Stdout) }
