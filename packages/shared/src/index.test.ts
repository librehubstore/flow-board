import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completionGroup, dueStatus, CreateUserInput, ROLE_PERMISSIONS, mentions } from './index.ts';

test('completionGroup : aujourd’hui, hier, puis date (fuseau respecté)', () => {
  const now = new Date('2026-10-04T10:00:00Z');
  assert.equal(completionGroup(new Date('2026-10-04T01:00:00Z'), now, 'UTC'), 'today');
  assert.equal(completionGroup(new Date('2026-10-03T23:00:00Z'), now, 'UTC'), 'yesterday');
  assert.equal(completionGroup(new Date('2026-10-03T23:00:00Z'), now, 'Europe/Paris'), 'today');
  assert.equal(completionGroup(new Date('2026-09-30T12:00:00Z'), now, 'UTC'), '2026-09-30');
});

test('dueStatus : tenue, manquée, en retard, J-1', () => {
  const due = new Date('2026-10-10T00:00:00Z');
  assert.equal(dueStatus(due, false, new Date('2026-10-10T20:00:00Z'), new Date()), 'met');
  assert.equal(dueStatus(due, false, new Date('2026-10-11T01:00:00Z'), new Date()), 'missed');
  assert.equal(dueStatus(due, false, null, new Date('2026-10-11T01:00:00Z')), 'overdue');
  assert.equal(dueStatus(due, false, null, new Date('2026-10-10T08:00:00Z')), 'soon');
  assert.equal(dueStatus(due, false, null, new Date('2026-10-05T08:00:00Z')), 'pending');
});

test('identifiant normalisé et validé', () => {
  assert.equal(CreateUserInput.parse({ username: ' Jean.Dupont ', fullName: 'J', password: 'x'.repeat(10) }).username, 'jean.dupont');
  assert.equal(CreateUserInput.safeParse({ username: 'ab', fullName: 'J', password: 'x'.repeat(10) }).success, false);
  assert.equal(CreateUserInput.safeParse({ username: 'abc', fullName: 'J', password: 'court' }).success, false);
});

test('le lecteur ne peut rien modifier', () => {
  assert.deepEqual(ROLE_PERMISSIONS.reader, ['board.view', 'reports.view']);
});

test('mentions : @identifiant, sans email ni ponctuation finale', () => {
  assert.deepEqual(mentions('Salut @Jean.Dupont et @marie. Voir a@b.com ou @jean.dupont'), ['jean.dupont', 'marie']);
});
