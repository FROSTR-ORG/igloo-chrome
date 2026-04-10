import { describe, expect, test } from 'vitest';

import {
  AppHeader,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ContentCard,
  Input,
  Label,
  OperatorDashboardTabs,
  OperatorPermissionsPanel,
  OperatorSettingsPanel,
  OperatorSignerPanel,
  PageLayout,
  ProfileConfirmationCard,
  Textarea,
  type LogEntry,
  type PeerPolicy,
} from 'igloo-ui';

function expectComponentExport(value: unknown) {
  expect(['function', 'object']).toContain(typeof value);
  expect(value).toBeTruthy();
}

describe('igloo-ui shim boundary', () => {
  test('exposes the Chrome UI surface through the built package boundary', () => {
    expectComponentExport(AppHeader);
    expectComponentExport(Button);
    expectComponentExport(Card);
    expectComponentExport(CardContent);
    expectComponentExport(CardHeader);
    expectComponentExport(CardTitle);
    expectComponentExport(ContentCard);
    expectComponentExport(Input);
    expectComponentExport(Label);
    expectComponentExport(OperatorDashboardTabs);
    expectComponentExport(OperatorPermissionsPanel);
    expectComponentExport(OperatorSettingsPanel);
    expectComponentExport(OperatorSignerPanel);
    expectComponentExport(PageLayout);
    expectComponentExport(ProfileConfirmationCard);
    expectComponentExport(Textarea);
  });

  test('keeps Chrome-consumed shared UI types available at compile time', () => {
    const samples: {
      logEntry: LogEntry;
      peerPolicy: PeerPolicy;
    } = {
      logEntry: {
        id: 'log-1',
        time: '12:00:00',
        level: 'INFO',
        message: 'ready',
      },
      peerPolicy: {
        alias: 'Peer 1',
        pubkey: 'peer-1',
        send: true,
        receive: true,
        state: 'online',
        lastSeen: Date.now(),
      },
    };

    expect(samples.logEntry.level).toBe('INFO');
    expect(samples.peerPolicy.pubkey).toBe('peer-1');
  });
});
