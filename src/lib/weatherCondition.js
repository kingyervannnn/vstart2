import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSun, Snowflake, Sun } from 'lucide-react'

export function weatherCondition(code) {
  const value = Number(code)
  if (value === 0) return { label: 'Clear', Icon: Sun }
  if (value <= 2) return { label: value === 1 ? 'Mostly clear' : 'Partly cloudy', Icon: CloudSun }
  if (value === 3) return { label: 'Overcast', Icon: Cloud }
  if (value === 45 || value === 48) return { label: 'Foggy', Icon: CloudFog }
  if (value >= 51 && value <= 57) return { label: 'Drizzle', Icon: CloudRain }
  if ((value >= 61 && value <= 67) || (value >= 80 && value <= 82)) {
    return { label: value >= 80 ? 'Rain showers' : 'Rain', Icon: CloudRain }
  }
  if ((value >= 71 && value <= 77) || (value >= 85 && value <= 86)) {
    return { label: value >= 85 ? 'Snow showers' : 'Snow', Icon: Snowflake }
  }
  if (value >= 95) return { label: 'Thunderstorms', Icon: CloudLightning }
  return { label: 'Current conditions', Icon: CloudSun }
}
