export type MailProviderType = 'smtp' | 'gmail' | 'sendgrid' | 'mailgun' | 'ses' | 'postmark' | 'resend' | 'brevo'

export interface EmailAddress {
  email: string
  name?: string
}

export interface Attachment {
  filename: string
  content: string | Buffer | NodeJS.ReadableStream
  contentType?: string
  cid?: string
}

export interface SendOptions {
  from: EmailAddress
  to: EmailAddress | EmailAddress[]
  cc?: EmailAddress[]
  bcc?: EmailAddress[]
  replyTo?: EmailAddress
  subject: string
  html?: string
  text?: string
  attachments?: Attachment[]
  headers?: Record<string, string>
  tags?: string[]
  metadata?: Record<string, string>
  templateId?: string
  templateData?: Record<string, any>
}

export interface SendResult {
  success: boolean
  messageId?: string
  error?: string
  provider?: MailProviderType
}

export interface VerifyResult {
  success: boolean
  error?: string
}

export interface ProviderConfig {
  type: MailProviderType
  name: string
  config: Record<string, any>
}