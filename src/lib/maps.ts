// Google マップを開くリンク（API キー不要）。スマホでは Google マップのアプリが入っていればアプリで開く。
// 住所は、押したときに端末から Google に送られる（このアプリのサーバは送らない）。
const enc = (s: string) => encodeURIComponent(s.trim())
export const mapUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${enc(address)}`
/** 現在地からの経路（出発地は端末の現在地） */
export const routeUrl = (address: string) => `https://www.google.com/maps/dir/?api=1&destination=${enc(address)}&travelmode=driving`
