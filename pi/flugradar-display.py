#!/usr/bin/env python3
"""Flugradar – schaltet das Display nachts aus und morgens wieder ein.

Liest die Einstellungen des Bildschirms vom Flugradar-Server (Verwaltung → Nachtmodus
"Display ausschalten" + Uhrzeiten) und schaltet die Ausgänge per wlr-randr.
Prüft einmal pro Minute. Im Zweifel (Server nicht erreichbar) bleibt das Display an.
"""
import glob
import json
import os
import subprocess
import time
import urllib.parse
import urllib.request
from datetime import datetime

CONF = '/etc/flugradar-kiosk.conf'


def read_conf():
    conf = {}
    try:
        with open(CONF, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    conf[k.strip()] = v.strip().strip('"\'')
    except OSError:
        pass
    return conf


def get_json(url):
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.load(r)


def screen_config(page_url):
    """Einstellungen des Bildschirms, den der Kiosk anzeigt (/s/<id> oder /s/ = erster)."""
    u = urllib.parse.urlsplit(page_url)
    base = f'{u.scheme}://{u.netloc}'
    parts = [p for p in u.path.split('/') if p]
    if len(parts) >= 2 and parts[0] == 's':
        return get_json(f'{base}/api/screens/{urllib.parse.quote(parts[1])}')
    screens = get_json(f'{base}/api/screens')
    return screens[0] if screens else None


def minutes(hhmm):
    h, m = hhmm.split(':')
    return int(h) * 60 + int(m)


def should_be_off(cfg, now):
    if not cfg or cfg.get('nightMode') != 'off':
        return False
    a, b = cfg.get('dimFrom') or '', cfg.get('dimTo') or ''
    if not a or not b:
        return False
    t, a, b = now.hour * 60 + now.minute, minutes(a), minutes(b)
    return a <= t < b if a <= b else (t >= a or t < b)


def wayland_env():
    env = dict(os.environ)
    rd = env.setdefault('XDG_RUNTIME_DIR', f'/run/user/{os.getuid()}')
    if 'WAYLAND_DISPLAY' not in env:
        socks = sorted(p for p in glob.glob(os.path.join(rd, 'wayland-*')) if not p.endswith('.lock'))
        if socks:
            env['WAYLAND_DISPLAY'] = os.path.basename(socks[0])
    return env


def outputs(env):
    """{Ausgang: eingeschaltet?} laut wlr-randr"""
    out = subprocess.run(['wlr-randr'], env=env, capture_output=True, text=True, timeout=10, check=True)
    result, name = {}, None
    for line in out.stdout.splitlines():
        if line and not line[0].isspace():
            name = line.split()[0]
            result[name] = True
        elif name and line.strip().startswith('Enabled:'):
            result[name] = line.split(':', 1)[1].strip().lower() == 'yes'
    return result


def main():
    while True:
        conf = read_conf()
        try:
            cfg = screen_config(conf.get('FLUGRADAR_URL', 'http://localhost:8080/s/'))
            want_on = not should_be_off(cfg, datetime.now())
        except Exception:
            want_on = True  # Server nicht erreichbar → Display an lassen
        env = wayland_env()
        if env.get('WAYLAND_DISPLAY'):
            try:
                # tatsächlichen Zustand prüfen – greift auch, wenn der Kiosk inzwischen neu gestartet wurde
                for name, enabled in outputs(env).items():
                    if enabled != want_on:
                        subprocess.run(['wlr-randr', '--output', name, '--on' if want_on else '--off'], env=env, timeout=10, check=True)
                        print(f"{datetime.now():%H:%M} Display {name} {'an' if want_on else 'aus'}", flush=True)
            except Exception as e:
                print(f'Display schalten fehlgeschlagen: {e}', flush=True)
        time.sleep(60)


if __name__ == '__main__':
    main()
