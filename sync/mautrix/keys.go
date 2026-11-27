// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"context"
	"go.mau.fi/mautrix-twitter/pkg/twittermeow/crypto"
	"math/big"
	"sync"
)

// Keys live only in this child process. No PIN or recovered private key is
// written to disk, returned through RPC, or included in a log.
type memoryKeys struct {
	mu            sync.RWMutex
	conversations map[string]*crypto.ConversationKey
	public        map[string]*crypto.PublicKeyInfo
	tokens        map[string]string
	own           *crypto.SigningKeyPair
}

func newKeys() *memoryKeys {
	return &memoryKeys{conversations: map[string]*crypto.ConversationKey{}, public: map[string]*crypto.PublicKeyInfo{}, tokens: map[string]string{}}
}
func newer(a, b string) bool {
	aa, ok := new(big.Int).SetString(a, 10)
	bb, okb := new(big.Int).SetString(b, 10)
	return ok && (!okb || aa.Cmp(bb) > 0)
}
func (s *memoryKeys) GetConversationKey(_ context.Context, c, v string) (*crypto.ConversationKey, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	k := s.conversations[c+":"+v]
	if k == nil {
		return nil, crypto.ErrKeyNotFound
	}
	return k, nil
}
func (s *memoryKeys) PutConversationKey(_ context.Context, k *crypto.ConversationKey) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.conversations[k.ConversationID+":"+k.KeyVersion] = k
	return nil
}
func (s *memoryKeys) DeleteConversationKey(_ context.Context, c, v string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.conversations, c+":"+v)
	return nil
}
func (s *memoryKeys) GetLatestConversationKey(_ context.Context, c string) (*crypto.ConversationKey, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var best *crypto.ConversationKey
	for _, k := range s.conversations {
		if k.ConversationID == c && (best == nil || newer(k.KeyVersion, best.KeyVersion)) {
			best = k
		}
	}
	if best == nil {
		return nil, crypto.ErrKeyNotFound
	}
	return best, nil
}
func (s *memoryKeys) GetOwnSigningKey(context.Context) (*crypto.SigningKeyPair, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.own == nil {
		return nil, crypto.ErrKeyNotFound
	}
	return s.own, nil
}
func (s *memoryKeys) PutOwnSigningKey(_ context.Context, k *crypto.SigningKeyPair) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.own = k
	return nil
}
func (s *memoryKeys) GetPublicKey(_ context.Context, u, v string) (*crypto.PublicKeyInfo, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	k := s.public[u+":"+v]
	if k == nil {
		return nil, crypto.ErrKeyNotFound
	}
	return k, nil
}
func (s *memoryKeys) PutPublicKey(_ context.Context, k *crypto.PublicKeyInfo) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.public[k.UserID+":"+k.KeyVersion] = k
	return nil
}
func (s *memoryKeys) GetConversationToken(_ context.Context, c string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v := s.tokens[c]
	if v == "" {
		return "", crypto.ErrKeyNotFound
	}
	return v, nil
}
func (s *memoryKeys) PutConversationToken(_ context.Context, c, v string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tokens[c] = v
	return nil
}
