export interface StaffInviteEmailPayload {
  toEmail: string;
  tenantName: string;
  roleName: string;
  inviteUrl: string;
  expiresAt: Date;
}

export interface PasswordResetEmailPayload {
  toEmail: string;
  fullName: string;
  resetUrl: string;
  expiresAt: Date;
}

export interface NotificationAdapter {
  readonly providerName: string;
  sendStaffInvite(payload: StaffInviteEmailPayload): Promise<{ delivered: boolean; mode: string }>;
  sendPasswordReset(
    payload: PasswordResetEmailPayload
  ): Promise<{ delivered: boolean; mode: string }>;
}

export interface CapturedNotification {
  type: 'staff_invite' | 'password_reset';
  toEmail: string;
  url: string;
  createdAt: string;
}

class DevCaptureNotificationAdapter implements NotificationAdapter {
  readonly providerName = 'dev_capture';
  private readonly captured: CapturedNotification[] = [];

  async sendStaffInvite(payload: StaffInviteEmailPayload) {
    this.captured.push({
      type: 'staff_invite',
      toEmail: payload.toEmail,
      url: payload.inviteUrl,
      createdAt: new Date().toISOString(),
    });
    if (this.captured.length > 50) this.captured.shift();
    return { delivered: true, mode: 'dev_capture' };
  }

  async sendPasswordReset(payload: PasswordResetEmailPayload) {
    this.captured.push({
      type: 'password_reset',
      toEmail: payload.toEmail,
      url: payload.resetUrl,
      createdAt: new Date().toISOString(),
    });
    if (this.captured.length > 50) this.captured.shift();
    return { delivered: true, mode: 'dev_capture' };
  }

  listRecent(): CapturedNotification[] {
    return [...this.captured];
  }

  clear(): void {
    this.captured.length = 0;
  }
}

export const devNotificationCapture = new DevCaptureNotificationAdapter();

export function getNotificationAdapter(): NotificationAdapter {
  // ADR-004: Default to provider-independent adapter; real Resend/SendGrid keys added in deployment
  return devNotificationCapture;
}
