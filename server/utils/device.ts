export enum DeviceType {
  Web = 'web',
  Mobile = 'mobile',
  Tablet = 'tablet',
  Desktop = 'desktop',
  Tv = 'tv',
  Wearable = 'wearable',
  Cli = 'cli',
  Other = 'other',
}

export type DeviceTypeValue = 'web' | 'mobile' | 'tablet' | 'desktop' | 'tv' | 'wearable' | 'cli' | 'other'

export function detectPlatform(userAgent: string, platform?: string): DeviceTypeValue {
  const ua = (userAgent || '').toLowerCase()
  const explicitPlatform = platform?.toLowerCase()

  if (explicitPlatform) {
    if (['web', 'mobile', 'tablet', 'desktop', 'tv', 'wearable', 'cli'].includes(explicitPlatform)) {
      return explicitPlatform as DeviceTypeValue
    }
  }

  if (ua.includes('cli') || ua.includes('command line') || ua.includes('terminal') || ua.includes('curl') || ua.includes('wget') || ua.includes('httpie') || ua.includes('postman')) {
    return DeviceType.Cli
  }

  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone') || ua.includes('ipod') || ua.includes('blackberry') || ua.includes('windows phone')) {
    if (ua.includes('tablet') || ua.includes('ipad') || (ua.includes('android') && !ua.includes('mobile'))) {
      return DeviceType.Tablet
    }
    return DeviceType.Mobile
  }

  if (ua.includes('tablet') || ua.includes('ipad') || (ua.includes('android') && !ua.includes('mobile'))) {
    return DeviceType.Tablet
  }

  if (ua.includes('smart-tv') || ua.includes('smarttv') || ua.includes('googletv') || ua.includes('appletv') || ua.includes('roku') || (ua.includes('tv') && (ua.includes('browser') || ua.includes('app')))) {
    return DeviceType.Tv
  }

  if (ua.includes('watch') || ua.includes('wearable') || ua.includes('wear os') || ua.includes('watchos') || ua.includes('galaxy watch')) {
    return DeviceType.Wearable
  }

  if (ua.includes('windows nt') || ua.includes('macintosh') || ua.includes('linux x86_64') || ua.includes('x11') || ua.includes('desktop')) {
    return DeviceType.Desktop
  }

  if (ua.includes('mozilla') || ua.includes('chrome') || ua.includes('safari') || ua.includes('firefox') || ua.includes('edge') || ua.includes('opera')) {
    return DeviceType.Web
  }

  return DeviceType.Other
}

export function getStableDeviceId(): string {
  if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
    const win = globalThis as unknown as { window: { localStorage?: Storage } }
    if (win.window?.localStorage) {
      let deviceId = win.window.localStorage.getItem('tm_device_id')
      if (!deviceId) {
        deviceId = crypto.randomUUID()
        win.window.localStorage.setItem('tm_device_id', deviceId)
      }
      return deviceId
    }
  }
  return ''
}