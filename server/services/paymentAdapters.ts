import crypto from 'node:crypto';
import type { PaymentProviderId } from '../../src/types/amal';
import { constantTimeEqual } from '../utils/cryptoAndMoney';

export type PaymentAdapterMode = 'disabled' | 'sandbox' | 'live';

export interface InitiatePaymentInput {
  tenantId: string;
  orderId: string;
  orderNumber: string;
  amountMinor: bigint;
  currencyCode: string;
  idempotencyKey: string;
}

export interface InitiatePaymentResult {
  mode: PaymentAdapterMode;
  status: 'pending' | 'authorized' | 'paid' | 'failed' | 'disabled';
  providerReference: string | null;
  checkoutUrl: string | null;
  message: string;
}

export interface VerifiedWebhookEvent {
  verified: boolean;
  providerEventId: string;
  providerReference: string;
  eventType: 'payment.succeeded' | 'payment.failed' | 'payment.refunded';
  reason?: string;
}

export interface PaymentProviderAdapter {
  readonly provider: PaymentProviderId;
  getMode(): PaymentAdapterMode;
  initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): VerifiedWebhookEvent;
}

function getConfiguredMode(): PaymentAdapterMode {
  const raw = (process.env.PAYMENT_MODE || 'disabled').toLowerCase();
  if (raw === 'sandbox') return 'sandbox';
  if (raw === 'live') return 'live';
  return 'disabled';
}

class ExternalGatewayStubAdapter implements PaymentProviderAdapter {
  constructor(
    readonly provider: 'chapa' | 'telebirr' | 'cbe_birr',
    private readonly secretEnvName: string
  ) {}

  getMode(): PaymentAdapterMode {
    const mode = getConfiguredMode();
    // ADR-001 guardrail: never enter live mode without verified provider credentials
    if (mode === 'live' && !process.env[this.secretEnvName]) {
      return 'disabled';
    }
    return mode;
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const mode = this.getMode();
    if (mode === 'disabled') {
      return {
        mode: 'disabled',
        status: 'pending',
        providerReference: null,
        checkoutUrl: null,
        message: `${this.provider} integration is in disabled mode until official KYB & sandbox credentials are verified (ADR-001). Order recorded as pending.`,
      };
    }

    if (mode === 'sandbox') {
      const ref = `sbx_${this.provider}_${input.orderNumber}_${crypto.randomBytes(4).toString('hex')}`;
      return {
        mode: 'sandbox',
        status: 'pending',
        providerReference: ref,
        checkoutUrl: null,
        message: `Sandbox payment intent registered (${ref}). Awaiting signed sandbox webhook confirmation.`,
      };
    }

    throw new Error(
      `Live ${this.provider} checkout is blocked until official API endpoints and signature verification are certified.`
    );
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>
  ): VerifiedWebhookEvent {
    const mode = this.getMode();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      return {
        verified: false,
        providerEventId: '',
        providerReference: '',
        eventType: 'payment.failed',
        reason: 'Malformed JSON body',
      };
    }

    const eventId = String(parsed.eventId || '');
    const providerReference = String(parsed.providerReference || '');
    const eventType = (parsed.eventType as VerifiedWebhookEvent['eventType']) || 'payment.succeeded';

    if (mode !== 'sandbox') {
      return {
        verified: false,
        providerEventId: eventId,
        providerReference,
        eventType,
        reason: 'External webhook signature verification is not enabled in disabled/unverified live mode',
      };
    }

    // In explicit sandbox mode only, verify against local SANDBOX_WEBHOOK_HMAC_SECRET
    const sandboxSecret = process.env.SANDBOX_WEBHOOK_HMAC_SECRET || 'amal_sandbox_webhook_secret';
    const sigHeader = headers['x-amal-sandbox-signature'];
    const presentedSig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    if (!presentedSig || !eventId || !providerReference) {
      return {
        verified: false,
        providerEventId: eventId,
        providerReference,
        eventType,
        reason: 'Missing sandbox signature or event identifiers',
      };
    }

    const expectedSig = crypto
      .createHmac('sha256', sandboxSecret)
      .update(rawBody)
      .digest('hex');

    if (!constantTimeEqual(presentedSig, expectedSig)) {
      return {
        verified: false,
        providerEventId: eventId,
        providerReference,
        eventType,
        reason: 'Invalid HMAC signature',
      };
    }

    return {
      verified: true,
      providerEventId: eventId,
      providerReference,
      eventType,
    };
  }
}

class OfflinePaymentAdapter implements PaymentProviderAdapter {
  constructor(readonly provider: 'cash' | 'room_charge') {}

  getMode(): PaymentAdapterMode {
    return 'live';
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    return {
      mode: 'live',
      status: 'pending',
      providerReference: `${this.provider}_${input.orderNumber}`,
      checkoutUrl: null,
      message:
        this.provider === 'room_charge'
          ? 'Posted to hotel room folio pending front-desk reconciliation.'
          : 'Pay cash on pickup / table.',
    };
  }

  verifyWebhook(): VerifiedWebhookEvent {
    return {
      verified: false,
      providerEventId: '',
      providerReference: '',
      eventType: 'payment.failed',
      reason: 'Offline providers do not accept webhooks',
    };
  }
}

const ADAPTERS: Record<PaymentProviderId, PaymentProviderAdapter> = {
  chapa: new ExternalGatewayStubAdapter('chapa', 'CHAPA_SECRET_KEY'),
  telebirr: new ExternalGatewayStubAdapter('telebirr', 'TELEBIRR_APP_SECRET'),
  cbe_birr: new ExternalGatewayStubAdapter('cbe_birr', 'CBE_BIRR_SECRET'),
  cash: new OfflinePaymentAdapter('cash'),
  room_charge: new OfflinePaymentAdapter('room_charge'),
};

export function getPaymentAdapter(provider: PaymentProviderId): PaymentProviderAdapter {
  return ADAPTERS[provider];
}
