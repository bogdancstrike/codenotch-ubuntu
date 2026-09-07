"""Desktop widgets: weather, battery, and system load.

Clock and date are rendered by the extension from the local clock, so they cost
no worker time at all. Weather is the only widget that touches the network and
it is cached hard: one request per `WEATHER_INTERVAL`, shared by every caller.
"""
import json
import os
import time
from pathlib import Path

from .model import ProviderError, number
from .providers import request_json

KINDS = ('clock', 'date', 'weather', 'battery', 'system')
WEATHER_INTERVAL = 900
GEOCODER = 'https://geocoding-api.open-meteo.com/v1/search'
FORECAST = 'https://api.open-meteo.com/v1/forecast'

# WMO weather interpretation codes -> (short label, symbol drawn by render.js).
CODES = {
    0: ('Clear', 'sun'), 1: ('Mostly clear', 'sun'), 2: ('Partly cloudy', 'partly'), 3: ('Overcast', 'cloud'),
    45: ('Fog', 'fog'), 48: ('Rime fog', 'fog'),
    51: ('Light drizzle', 'drizzle'), 53: ('Drizzle', 'drizzle'), 55: ('Heavy drizzle', 'drizzle'),
    56: ('Freezing drizzle', 'sleet'), 57: ('Freezing drizzle', 'sleet'),
    61: ('Light rain', 'rain'), 63: ('Rain', 'rain'), 65: ('Heavy rain', 'rain'),
    66: ('Freezing rain', 'sleet'), 67: ('Freezing rain', 'sleet'),
    71: ('Light snow', 'snow'), 73: ('Snow', 'snow'), 75: ('Heavy snow', 'snow'), 77: ('Snow grains', 'snow'),
    80: ('Showers', 'rain'), 81: ('Showers', 'rain'), 82: ('Heavy showers', 'rain'),
    85: ('Snow showers', 'snow'), 86: ('Snow showers', 'snow'),
    95: ('Thunderstorm', 'storm'), 96: ('Thunderstorm', 'storm'), 99: ('Thunderstorm', 'storm'),
}


def search_places(query):
    """Geocode a free-text place name. No credentials, no user identifiers."""
    text = (query or '').strip()
    if len(text) < 2:
        return []
    data = request_json(f'{GEOCODER}?name={_quote(text)}&count=8&language=en&format=json', {})
    out = []
    for row in data.get('results') or []:
        lat, lon = number(row.get('latitude')), number(row.get('longitude'))
        if lat is None or lon is None:
            continue
        parts = [row.get('name'), row.get('admin1'), row.get('country')]
        out.append(dict(
            name=str(row.get('name') or text),
            label=', '.join(str(p) for p in parts if p),
            latitude=round(lat, 4), longitude=round(lon, 4),
            timezone=str(row.get('timezone') or 'auto'),
        ))
    return out


def _quote(text):
    from urllib.parse import quote
    return quote(text, safe='')


def fetch_weather(settings):
    lat, lon = number(settings.get('weatherLat')), number(settings.get('weatherLon'))
    if lat is None or lon is None:
        raise ProviderError('unavailable', 'Choose a weather location in settings.')
    imperial = settings.get('weatherUnits') == 'imperial'
    url = (f'{FORECAST}?latitude={lat:.4f}&longitude={lon:.4f}'
           '&current=temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m,wind_speed_10m'
           '&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto'
           + ('&temperature_unit=fahrenheit&wind_speed_unit=mph' if imperial else ''))
    data = request_json(url, {})
    current = data.get('current') or {}
    daily = data.get('daily') or {}
    temp = number(current.get('temperature_2m'))
    if temp is None:
        raise ProviderError('error', 'The weather service returned no temperature.')
    code = int(number(current.get('weather_code')) or 0)
    label, symbol = CODES.get(code, ('Weather', 'cloud'))
    if not current.get('is_day') and symbol in ('sun', 'partly'):
        symbol = 'moon' if symbol == 'sun' else 'partlynight'
    return dict(
        temp=round(temp), feels=_round(current.get('apparent_temperature')),
        humidity=_round(current.get('relative_humidity_2m')), wind=_round(current.get('wind_speed_10m')),
        high=_round(_first(daily.get('temperature_2m_max'))), low=_round(_first(daily.get('temperature_2m_min'))),
        code=code, text=label, symbol=symbol,
        unit='F' if imperial else 'C', windUnit='mph' if imperial else 'km/h',
        place=str(settings.get('weatherPlace') or ''), updatedAt=time.time(),
    )


def _first(value):
    return value[0] if isinstance(value, list) and value else None


def _round(value):
    n = number(value)
    return None if n is None else round(n)


def weather(settings, cache, force=False):
    """Return cached weather, refreshing at most once per WEATHER_INTERVAL."""
    now = time.time()
    old = cache.get('weather') if isinstance(cache.get('weather'), dict) else {}
    place_changed = old.get('key') != _weather_key(settings)
    if not force and not place_changed and now - (old.get('updatedAt') or 0) < WEATHER_INTERVAL:
        return old
    try:
        row = fetch_weather(settings)
    except ProviderError as err:
        if old and not place_changed:
            return {**old, 'status': 'stale', 'message': err.message}
        return dict(status=err.status, message=err.message, key=_weather_key(settings), updatedAt=0)
    return {**row, 'status': 'ok', 'message': '', 'key': _weather_key(settings)}


def _weather_key(settings):
    return f"{settings.get('weatherLat')},{settings.get('weatherLon')},{settings.get('weatherUnits')}"


def battery(root=Path('/sys/class/power_supply')):
    """First system battery; device batteries (mice, keyboards) are ignored."""
    try:
        entries = sorted(root.iterdir())
    except OSError:
        return None
    for entry in entries:
        try:
            if _read(entry / 'type') != 'Battery' or _read(entry / 'scope') == 'Device':
                continue
            percent = number(_read(entry / 'capacity'))
            if percent is None:
                continue
            state = _read(entry / 'status') or 'Unknown'
            return dict(percent=max(0, min(100, round(percent))), charging=state in ('Charging', 'Full'),
                        state=state, name=entry.name)
        except OSError:
            continue
    return None


def _read(path):
    try:
        return path.read_text().strip()
    except OSError:
        return ''


def system(cache, proc=Path('/proc')):
    """CPU busy fraction between the previous sample and now, plus memory in use."""
    out = {}
    try:
        fields = [int(x) for x in proc.joinpath('stat').read_text().split('\n')[0].split()[1:11]]
        total, idle = sum(fields), fields[3] + fields[4]
        previous = cache.get('cpu') if isinstance(cache.get('cpu'), dict) else {}
        last_total, last_idle = previous.get('total', 0), previous.get('idle', 0)
        span = total - last_total
        if span > 0 and last_total:
            out['cpu'] = max(0.0, min(1.0, 1 - (idle - last_idle) / span))
        cache['cpu'] = dict(total=total, idle=idle)
    except (OSError, ValueError, IndexError):
        pass
    try:
        values = {}
        for line in proc.joinpath('meminfo').read_text().splitlines()[:8]:
            key, _, rest = line.partition(':')
            values[key] = float(rest.strip().split()[0])
        if values.get('MemTotal'):
            available = values.get('MemAvailable', values.get('MemFree', 0))
            out['mem'] = max(0.0, min(1.0, 1 - available / values['MemTotal']))
            out['memTotal'] = round(values['MemTotal'] / 1048576, 1)
            out['memUsed'] = round((values['MemTotal'] - available) / 1048576, 1)
    except (OSError, ValueError, IndexError):
        pass
    return out or None


def collect(settings, cache, force=False):
    """Build the widget payload for the requested widget list."""
    wanted = [k for k in settings.get('widgets') or [] if k in KINDS]
    out = {}
    if 'weather' in wanted:
        out['weather'] = weather(settings, cache, force)
    if 'battery' in wanted:
        found = battery()
        if found:
            out['battery'] = found
    if 'system' in wanted:
        found = system(cache)
        if found:
            out['system'] = found
    return out
