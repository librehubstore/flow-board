import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  completionGroup,
  dueStatus,
  CreateUserInput,
  ROLE_PERMISSIONS,
  mentions,
  matchesFilter,
  BoardFilter,
  type FilterableTask,
} from './index.ts';

test('filtre de board : ET entre critères, OU au sein d’un critère (§ 4.5)', () => {
  const base: FilterableTask = {
    name: 'Renouveler le certificat',
    description: '',
    color: 'red',
    responsibleUserId: 'me-id',
    labels: [{ id: 'urgent' }],
    dueAt: null,
    dueHasTime: false,
    completedAt: null,
  };
  const ctx = {
    me: 'me-id',
    now: new Date('2026-10-07T10:00:00Z'),
    timeZone: 'UTC',
    labelNames: new Map([['urgent', 'Urgent']]),
  };
  const f = (x: object) => BoardFilter.parse(x);
  // « responsable = moi » + label « urgent » : seules les tâches satisfaisant les deux.
  assert.equal(matchesFilter(base, f({ responsible: ['me'], labels: ['urgent'] }), ctx), true);
  assert.equal(
    matchesFilter({ ...base, labels: [] }, f({ responsible: ['me'], labels: ['urgent'] }), ctx),
    false,
  );
  assert.equal(
    matchesFilter({ ...base, responsibleUserId: null }, f({ responsible: ['me', 'none'] }), ctx),
    true,
  );
  assert.equal(matchesFilter(base, f({ colors: ['blue', 'red'] }), ctx), true);
  // Texte : sans accents ni casse, sur le nom et les labels.
  assert.equal(matchesFilter(base, f({ text: 'CERTIF urgent' }), ctx), true);
  assert.equal(matchesFilter(base, f({ text: 'dns' }), ctx), false);
  // Échéances (mercredi 7 octobre 2026).
  const due = (iso: string | null) => ({ ...base, dueAt: iso });
  assert.equal(matchesFilter(due('2026-10-06T00:00:00.000Z'), f({ due: ['overdue'] }), ctx), true);
  assert.equal(matchesFilter(due('2026-10-07T00:00:00.000Z'), f({ due: ['today'] }), ctx), true);
  assert.equal(matchesFilter(due('2026-10-11T00:00:00.000Z'), f({ due: ['week'] }), ctx), true);
  assert.equal(matchesFilter(due('2026-10-12T00:00:00.000Z'), f({ due: ['week'] }), ctx), false);
  assert.equal(matchesFilter(due(null), f({ due: ['none'] }), ctx), true);
});

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
  assert.equal(
    CreateUserInput.parse({ username: ' Jean.Dupont ', fullName: 'J', password: 'x'.repeat(10) }).username,
    'jean.dupont',
  );
  assert.equal(
    CreateUserInput.safeParse({ username: 'ab', fullName: 'J', password: 'x'.repeat(10) }).success,
    false,
  );
  assert.equal(
    CreateUserInput.safeParse({ username: 'abc', fullName: 'J', password: 'court' }).success,
    false,
  );
});

test('le lecteur ne peut rien modifier', () => {
  assert.deepEqual(ROLE_PERMISSIONS.reader, ['board.view', 'reports.view']);
});

test('mentions : @identifiant, sans email ni ponctuation finale', () => {
  assert.deepEqual(mentions('Salut @Jean.Dupont et @marie. Voir a@b.com ou @jean.dupont'), [
    'jean.dupont',
    'marie',
  ]);
});
