export interface App {
  id: string
  name: string
  description?: string
  secretKey: string
  allowedOrigins: string[]
  isActive: boolean
  isPinned: boolean
  isSystem?: boolean
  sort: number
  createdAt: string
  updatedAt: string
}
