#!/usr/bin/env python3
"""WS2812B по SPI0 MOSI (GPIO 10, физический пин 19). См. docs/PINS.md.

4 бита SPI на 3.2 МГц (бит SPI = 312.5 нс): 0 -> 1000, 1 -> 1110.
Порядок цвета на ленте GRB. Кадр приходит строкой JSON: {"pixels":[[r,g,b],...]}.
Частота ядра платы должна быть зафиксирована: core_freq=250 и core_freq_min=250.
"""

import json
import sys

SPI_HZ = 3200000
LED_COUNT = 48
RESET_BYTES = 100

def _spi_bytes(value):
    out = 0
    for _ in range(8):
        out = (out << 4) | (0b1110 if value & 0x80 else 0b1000)
        value = (value << 1) & 0xFF
    return bytes((
        (out >> 24) & 0xFF,
        (out >> 16) & 0xFF,
        (out >> 8) & 0xFF,
        out & 0xFF,
    ))

LUT = tuple(_spi_bytes(value) for value in range(256))

def encode_frame(pixels):
    buf = bytearray(LED_COUNT * 12 + RESET_BYTES)
    offset = 0
    for pixel in pixels:
        green = int(pixel[1]) & 255
        red = int(pixel[0]) & 255
        blue = int(pixel[2]) & 255
        buf[offset:offset + 4] = LUT[green]
        offset += 4
        buf[offset:offset + 4] = LUT[red]
        offset += 4
        buf[offset:offset + 4] = LUT[blue]
        offset += 4
    return buf

def normalize(pixels):
    frame = []
    if isinstance(pixels, list):
        for pixel in pixels[:LED_COUNT]:
            if isinstance(pixel, list) and len(pixel) >= 3:
                frame.append((int(pixel[0]), int(pixel[1]), int(pixel[2])))
            else:
                frame.append((0, 0, 0))
    while len(frame) < LED_COUNT:
        frame.append((0, 0, 0))
    return frame

def self_check():
    assert len(LUT) == 256
    assert LUT[0x00] == bytes((0x88, 0x88, 0x88, 0x88))
    assert LUT[0xFF] == bytes((0xEE, 0xEE, 0xEE, 0xEE))
    assert LUT[0x80] == bytes((0xE8, 0x88, 0x88, 0x88))
    for value in (0x00, 0xFF, 0x80, 0xA5, 0x5A):
        bits = ''.join(f'{byte:08b}' for byte in LUT[value])
        expect = ''.join('1110' if value & (1 << bit) else '1000' for bit in range(7, -1, -1))
        assert bits == expect
    pixels = [(255, 0, 0)] + [(0, 0, 0)] * (LED_COUNT - 1)
    frame = encode_frame(pixels)
    assert isinstance(frame, bytearray)
    assert frame[:4] == LUT[0]
    assert frame[4:8] == LUT[255]
    assert frame[8:12] == LUT[0]
    assert len(frame) == LED_COUNT * 12 + RESET_BYTES
    assert frame[-RESET_BYTES:] == bytes(RESET_BYTES)
    assert bytes(frame[12:-RESET_BYTES]) == LUT[0] * 3 * (LED_COUNT - 1)

def main():
    try:
        import spidev
    except ImportError:
        sys.stderr.write('Нет модуля spidev. Команда: sudo apt install python3-spidev\n')
        sys.exit(1)

    spi = spidev.SpiDev()
    try:
        spi.open(0, 0)
    except OSError as err:
        sys.stderr.write('Не открыть /dev/spidev0.0: %s\n' % err)
        sys.exit(1)

    spi.max_speed_hz = SPI_HZ
    spi.mode = 0
    spi.bits_per_word = 8
    try:
        spi.no_cs = True
    except AttributeError:
        pass
    blank = encode_frame([(0, 0, 0)] * LED_COUNT)
    sys.stdout.write('ready\n')
    sys.stdout.flush()

    try:
        while True:
            line = sys.stdin.readline()
            if line == '':
                break
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            try:
                spi.writebytes2(encode_frame(normalize(msg.get('pixels'))))
            except OSError as err:
                sys.stderr.write('SPI: %s\n' % err)
                sys.exit(1)
    finally:
        try:
            spi.writebytes2(blank)
        except OSError:
            pass
        spi.close()

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--check':
        self_check()
        print('ok')
    else:
        main()
