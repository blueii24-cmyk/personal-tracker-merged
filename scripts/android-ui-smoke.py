#!/usr/bin/env python3
"""Exercise the built APK on a fresh Android emulator; keep screen evidence on failure."""
import os
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

OUT = Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'android-ui-evidence'
OUT.mkdir(parents=True, exist_ok=True)
PKG = 'com.blueii24.personaltracker'


def adb(*args, binary=False):
    return subprocess.check_output(['adb', *args], timeout=35, text=not binary)


def screenshot(name):
    (OUT / (name + '.png')).write_bytes(adb('exec-out', 'screencap', '-p', binary=True))


def hierarchy(name):
    adb('shell', 'uiautomator', 'dump', '/sdcard/window.xml')
    data = adb('exec-out', 'cat', '/sdcard/window.xml')
    (OUT / (name + '.xml')).write_text(data)
    return ET.fromstring(data)


def snapshot(name):
    screenshot(name)
    (OUT / (name + '-ime.txt')).write_text(adb('shell', 'dumpsys', 'input_method'))
    return hierarchy(name)


def wait_for(find, label, timeout=45):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            root = hierarchy('latest')
            found = find(root)
            if found is not None:
                return found
        except (ET.ParseError, subprocess.SubprocessError):
            pass
        time.sleep(1)
    raise AssertionError('Could not find ' + label + '; see UI evidence')


def match(root, text):
    return next((n for n in root.iter('node') if text.lower() in (n.get('text', '') + ' ' + n.get('content-desc', '')).lower()), None)


def bounds(node):
    nums = [int(n) for n in re.findall(r'\d+', node.get('bounds', ''))]
    if len(nums) != 4:
        raise AssertionError('Missing UI bounds: ' + ET.tostring(node, encoding='unicode'))
    return nums


def tap(node):
    x1, y1, x2, y2 = bounds(node)
    adb('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))


def ime_visible():
    state = adb('shell', 'dumpsys', 'input_method')
    # Android versions expose one of these fields; fail rather than assume if neither is available.
    flags = re.findall(r'(?:mInputShown|isInputViewShown)=(true|false)', state)
    if not flags:
        raise AssertionError('Android did not expose an IME visibility flag; see evidence')
    return 'true' in flags


def edit_field(root):
    return next((n for n in root.iter('node') if n.get('class') == 'android.widget.EditText' and n.get('package') == PKG), None)


def no_native_title(root):
    def walk(node, inside_web=False):
        inside_web = inside_web or node.get('class', '').endswith('WebView')
        if not inside_web and node.get('package') == PKG:
            assert node.get('text') != 'Personal Tracker', 'Native app title is visible'
            assert 'Toolbar' not in node.get('class', '') and 'ActionBar' not in node.get('class', ''), 'Native bar is visible'
        for child in node:
            walk(child, inside_web)
    walk(root)

try:
    apk = os.environ['ANDROID_TEST_APK']
    adb('install', '-r', apk)
    adb('shell', 'am', 'start', '-n', PKG + '/.MainActivity')
    chat_link = wait_for(lambda r: match(r, 'Chat'), 'Chat navigation')
    root = snapshot('01-overview')
    no_native_title(root)
    tap(chat_link)
    field = wait_for(edit_field, 'chat input')
    root = snapshot('02-chat-closed')
    no_native_title(root)
    assert not ime_visible(), 'IME opened automatically on entering chat'
    before = bounds(field)
    tap(field)
    deadline = time.monotonic() + 15
    while not ime_visible() and time.monotonic() < deadline:
        time.sleep(0.5)
    assert ime_visible(), 'IME did not open after tapping the input'
    field = wait_for(edit_field, 'chat input with keyboard')
    opened = bounds(field)
    snapshot('03-chat-ime-open')
    assert opened[3] < before[3] - 50, f'Composer did not move above IME: closed={before}, open={opened}'
    adb('shell', 'input', 'text', 'hello')
    send = wait_for(lambda r: match(r, 'Send message'), 'send button')
    tap(send)
    wait_for(lambda r: match(r, 'hello'), 'sent message')
    snapshot('04-message-sent')
    # Sending may dismiss the IME. Reopen it before testing that Back closes the keyboard,
    # rather than testing ordinary app navigation when the keyboard is already hidden.
    if not ime_visible():
        tap(wait_for(edit_field, 'chat input after sending'))
        deadline = time.monotonic() + 15
        while not ime_visible() and time.monotonic() < deadline:
            time.sleep(0.5)
    assert ime_visible(), 'IME did not reopen for dismissal test'
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    deadline = time.monotonic() + 15
    while ime_visible() and time.monotonic() < deadline:
        time.sleep(0.5)
    assert not ime_visible(), 'IME did not close'
    restored = bounds(wait_for(edit_field, 'chat input after keyboard closes'))
    snapshot('05-chat-ime-closed')
    assert abs(restored[3] - before[3]) < 30, f'Composer did not restore: {before}, {restored}'
    adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '1')
    time.sleep(3)
    field = wait_for(edit_field, 'landscape chat input')
    landscape_before = bounds(field)
    tap(field)
    deadline = time.monotonic() + 15
    while not ime_visible() and time.monotonic() < deadline:
        time.sleep(0.5)
    assert ime_visible(), 'Landscape IME did not open'
    landscape_open = bounds(wait_for(edit_field, 'landscape input with keyboard'))
    snapshot('06-landscape-ime-open')
    assert landscape_open[3] < landscape_before[3], f'Landscape composer did not resize: {landscape_before}, {landscape_open}'
    print(f'::notice::Android UI PASS: native title, no autofocus, IME, send and dismissal. Portrait input closed={before}, open={opened}, restored={restored}; landscape closed={landscape_before}, open={landscape_open}', flush=True)
except Exception as error:
    print(f'::error::Android UI smoke failed: {type(error).__name__}: {error}', flush=True)
    try:
        root = snapshot('failure')
        nodes = [f"{n.get('class', '')} text={n.get('text', '')!r} desc={n.get('content-desc', '')!r} bounds={n.get('bounds', '')}" for n in root.iter('node') if n.get('package') == PKG]
        print('::notice::Android UI nodes: ' + ' | '.join(nodes)[:12000], flush=True)
    except Exception as snapshot_error:
        print(f'::notice::Could not capture failure UI: {snapshot_error}', flush=True)
    raise
