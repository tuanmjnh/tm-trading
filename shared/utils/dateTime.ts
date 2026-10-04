export function formatDate(dateInput: string | number | Date | null | undefined, locale = 'vi-VN'): string {
  if (!dateInput) return ''
  const date = new Date(dateInput)
  if (isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

export function formatDateOnly(dateInput: string | number | Date | null | undefined, locale = 'vi-VN'): string {
  if (!dateInput) return ''
  const date = new Date(dateInput)
  if (isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

export function formatRelativeTime(dateInput: string | number | Date | null | undefined, isEn = false): string {
  if (!dateInput) return ''
  const date = new Date(dateInput)
  if (isNaN(date.getTime())) return ''
  const now = Date.now()
  const diffInSeconds = Math.floor((now - date.getTime()) / 1000)

  if (diffInSeconds < 60) return isEn ? 'Just now' : 'Vừa xong'
  const diffInMinutes = Math.floor(diffInSeconds / 60)
  if (diffInMinutes < 60) return isEn ? `${diffInMinutes}m ago` : `${diffInMinutes} phút trước`
  const diffInHours = Math.floor(diffInMinutes / 60)
  if (diffInHours < 24) return isEn ? `${diffInHours}h ago` : `${diffInHours} giờ trước`
  const diffInDays = Math.floor(diffInHours / 24)
  if (diffInDays < 30) return isEn ? `${diffInDays}d ago` : `${diffInDays} ngày trước`

  return formatDate(date, isEn ? 'en-US' : 'vi-VN')
}
