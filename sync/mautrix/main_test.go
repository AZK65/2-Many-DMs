// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"go.mau.fi/mautrix-twitter/pkg/twittermeow/crypto"
	"go.mau.fi/mautrix-twitter/pkg/twittermeow/data/payload"
	"go.mau.fi/mautrix-twitter/pkg/twittermeow/data/types"
	"sync"
	"testing"
	"time"
)

func TestHistoryRequestAlwaysIncludesKeyVersion(t *testing.T) {
	v := historyVariables("1:2", "", "")
	if v.MinLocalSequenceID != historyMax || v.MinConversationKeyVersion != historyMax {
		t.Fatal("initial history request would omit required X boundary")
	}
	v = historyVariables("1:2", "500", "200")
	if v.MinLocalSequenceID != "500" || v.MinConversationKeyVersion != "200" {
		t.Fatal("lost resumed message or key boundary")
	}
}

func TestHistoryIdentityNormalizationAndChronology(t *testing.T) {
	encode := func(seq, conv string) string {
		e := payload.MessageEvent{SequenceId: &seq}
		if conv != "" {
			e.ConversationId = &conv
		}
		raw, err := payload.Encode(&e)
		if err != nil {
			t.Fatal(err)
		}
		return base64.StdEncoding.EncodeToString(raw)
	}
	events, err := historyEvents("1:2", []string{encode("100", ""), encode("9", "1:2")})
	if err != nil {
		t.Fatal(err)
	}
	if *events[0].SequenceId != "9" || *events[1].ConversationId != "1:2" {
		t.Fatal("incorrect history identity or ordering")
	}
	if _, err = historyEvents("1:2", []string{encode("100", "3:4")}); err == nil {
		t.Fatal("cross-chat event was accepted")
	}
	if _, err = historyEvents("1:2", []string{"invalid-base64"}); err == nil {
		t.Fatal("corrupt page was accepted")
	}
}

type eventWriter struct{ emitted chan map[string]any }

func (w eventWriter) Write(p []byte) (int, error) {
	var v map[string]any
	_ = json.Unmarshal(p, &v)
	w.emitted <- v
	return len(p), nil
}

func TestEventRequiresDurableParentAcknowledgement(t *testing.T) {
	for _, accepted := range []bool{false, true} {
		output := eventWriter{make(chan map[string]any, 1)}
		b := &bridge{output: output}
		result := make(chan bool, 1)
		go func() {
			result <- b.event(context.Background(), &types.Message{ID: "900", RequestID: "native-uuid", ConversationID: "1:2"})
		}()
		evt := <-output.emitted
		if evt["nativeId"] != "native-uuid" {
			t.Fatal("numeric sequence replaced native identity")
		}
		select {
		case <-result:
			t.Fatal("event was accepted before storage")
		default:
		}
		ack, ok := b.acknowledgements.Load(evt["eventId"])
		if !ok {
			t.Fatal("missing acknowledgement")
		}
		ack.(chan bool) <- accepted
		select {
		case actual := <-result:
			if actual != accepted {
				t.Fatal("ignored failed storage")
			}
		case <-time.After(time.Second):
			t.Fatal("ack blocked")
		}
	}
}

func TestCancelledEventDoesNotClaimStorage(t *testing.T) {
	output := eventWriter{make(chan map[string]any, 1)}
	b := &bridge{output: output}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if b.event(ctx, &types.Message{ID: "1", ConversationID: "1:2"}) {
		t.Fatal("cancelled event accepted")
	}
}

func TestKeysConcurrentHistoryAndLiveAccess(t *testing.T) {
	keys := newKeys()
	ctx := context.Background()
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for _, version := range []string{"9", "100", "20"} {
				_ = keys.PutConversationKey(ctx, &crypto.ConversationKey{ConversationID: "1:2", KeyVersion: version})
				_, _ = keys.GetLatestConversationKey(ctx, "1:2")
			}
		}()
	}
	wg.Wait()
	latest, err := keys.GetLatestConversationKey(ctx, "1:2")
	if err != nil || latest.KeyVersion != "100" {
		t.Fatal("wrong newest key")
	}
	if _, err = keys.GetLatestConversationKey(ctx, "another"); err == nil {
		t.Fatal("keys leaked across chats")
	}
}

func TestMediaSizeBound(t *testing.T) {
	var b boundedBuffer
	if _, err := b.Write(make([]byte, 25<<20)); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Write([]byte{1}); err == nil {
		t.Fatal("oversized attachment accepted")
	}
}
