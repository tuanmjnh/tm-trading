export default defineNuxtPlugin(() => {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/push-sw.js')
      .then((registration) => {
        console.log('✅ Service Worker registered with scope:', registration.scope)
      })
      .catch((error) => {
        console.error('❌ Service Worker registration failed:', error)
      })
  }
})
