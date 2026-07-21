export const DEFAULT_LOCATION_ID = 'new-york'

export const LOCATION_OPTIONS = [
  { id: 'new-york', city: 'New York', country: 'US', timeZone: 'America/New_York', latitude: 40.7128, longitude: -74.006 },
  { id: 'yerevan', city: 'Yerevan', country: 'AM', timeZone: 'Asia/Yerevan', latitude: 40.1872, longitude: 44.5152 },
  { id: 'vienna', city: 'Vienna', country: 'AT', timeZone: 'Europe/Vienna', latitude: 48.2082, longitude: 16.3738 },
  { id: 'london', city: 'London', country: 'GB', timeZone: 'Europe/London', latitude: 51.5072, longitude: -0.1276 },
  { id: 'tokyo', city: 'Tokyo', country: 'JP', timeZone: 'Asia/Tokyo', latitude: 35.6762, longitude: 139.6503 },
  { id: 'los-angeles', city: 'Los Angeles', country: 'US', timeZone: 'America/Los_Angeles', latitude: 34.0522, longitude: -118.2437 },
  { id: 'chicago', city: 'Chicago', country: 'US', timeZone: 'America/Chicago', latitude: 41.8781, longitude: -87.6298 },
  { id: 'toronto', city: 'Toronto', country: 'CA', timeZone: 'America/Toronto', latitude: 43.6532, longitude: -79.3832 },
  { id: 'mexico-city', city: 'Mexico City', country: 'MX', timeZone: 'America/Mexico_City', latitude: 19.4326, longitude: -99.1332 },
  { id: 'sao-paulo', city: 'São Paulo', country: 'BR', timeZone: 'America/Sao_Paulo', latitude: -23.5505, longitude: -46.6333 },
  { id: 'paris', city: 'Paris', country: 'FR', timeZone: 'Europe/Paris', latitude: 48.8566, longitude: 2.3522 },
  { id: 'berlin', city: 'Berlin', country: 'DE', timeZone: 'Europe/Berlin', latitude: 52.52, longitude: 13.405 },
  { id: 'rome', city: 'Rome', country: 'IT', timeZone: 'Europe/Rome', latitude: 41.9028, longitude: 12.4964 },
  { id: 'tbilisi', city: 'Tbilisi', country: 'GE', timeZone: 'Asia/Tbilisi', latitude: 41.7151, longitude: 44.8271 },
  { id: 'dubai', city: 'Dubai', country: 'AE', timeZone: 'Asia/Dubai', latitude: 25.2048, longitude: 55.2708 },
  { id: 'singapore', city: 'Singapore', country: 'SG', timeZone: 'Asia/Singapore', latitude: 1.3521, longitude: 103.8198 },
  { id: 'hong-kong', city: 'Hong Kong', country: 'HK', timeZone: 'Asia/Hong_Kong', latitude: 22.3193, longitude: 114.1694 },
  { id: 'sydney', city: 'Sydney', country: 'AU', timeZone: 'Australia/Sydney', latitude: -33.8688, longitude: 151.2093 },
]

const LOCATION_BY_ID = new Map(LOCATION_OPTIONS.map((location) => [location.id, location]))

export function locationById(id) {
  return LOCATION_BY_ID.get(id) || LOCATION_BY_ID.get(DEFAULT_LOCATION_ID)
}

export function configuredWeatherLocations(settings = {}) {
  const primary = locationById(settings.primaryLocationId)
  const seen = new Set([primary.id])
  const secondary = []
  for (const id of Array.isArray(settings.secondaryLocationIds) ? settings.secondaryLocationIds : []) {
    const location = LOCATION_BY_ID.get(id)
    if (!location || seen.has(location.id)) continue
    seen.add(location.id)
    secondary.push(location)
    if (secondary.length === 2) break
  }
  return { primary, secondary, all: [primary, ...secondary] }
}

export function activeWeatherLocation(settings = {}) {
  const configured = configuredWeatherLocations(settings)
  return configured.all.find((location) => location.id === settings.activeWeatherLocationId) || configured.primary
}

export function weatherForecastUrl(location, { celsius = false, detailed = false } = {}) {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(location.latitude))
  url.searchParams.set('longitude', String(location.longitude))
  url.searchParams.set('current', detailed
    ? 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m'
    : 'temperature_2m,weather_code')
  url.searchParams.set('daily', detailed
    ? 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset'
    : 'weather_code,temperature_2m_max,temperature_2m_min')
  if (detailed) {
    url.searchParams.set('hourly', 'temperature_2m,apparent_temperature,weather_code,precipitation_probability,relative_humidity_2m,wind_speed_10m')
  }
  url.searchParams.set('temperature_unit', celsius ? 'celsius' : 'fahrenheit')
  url.searchParams.set('wind_speed_unit', celsius ? 'kmh' : 'mph')
  url.searchParams.set('timezone', location.timeZone)
  url.searchParams.set('forecast_days', '7')
  return url.toString()
}

export function formatLocationTime(date, location, twentyFourHour = false) {
  const parts = new Intl.DateTimeFormat([], {
    hour: '2-digit',
    minute: '2-digit',
    ...(twentyFourHour ? { hourCycle: 'h23' } : { hour12: true }),
    timeZone: location.timeZone,
  }).formatToParts(date)
  const read = (type) => parts.find((part) => part.type === type)?.value || ''
  return {
    hour: read('hour'),
    minute: read('minute'),
    period: read('dayPeriod').toUpperCase(),
  }
}
