import spidev
import time

# Открываем SPI0.0 (Пин 19)
spi = spidev.SpiDev()
spi.open(0, 0)
spi.max_speed_hz = 3200000
spi.mode = 0

# 1 байт цвета -> 4 байта SPI (0 -> 1000, 1 -> 1110)
LOOKUP = []
for b in range(256):
    val = 0
    for bit in range(7, -1, -1):
        nibble = 0xE if (b & (1 << bit)) else 0x8
        val = (val << 4) | nibble
    LOOKUP.append(val.to_bytes(4, byteorder='big'))

def send_color(r, g, b, count=16):
    buf = bytearray()
    for _ in range(count):
        buf += LOOKUP[g]  # WS2812B ждет GRB
        buf += LOOKUP[r]
        buf += LOOKUP[b]
    buf += bytes(100)     # Latch / Reset
    spi.writebytes2(buf)

print("Запуск теста: диоды должны плавно менять цвета...")

try:
    while True:
        print("Красный (тусклый)")
        send_color(30, 0, 0)
        time.sleep(1)

        print("Зеленый (тусклый)")
        send_color(0, 30, 0)
        time.sleep(1)

        print("Синий (тусклый)")
        send_color(0, 0, 30)
        time.sleep(1)

        print("Выключено")
        send_color(0, 0, 0)
        time.sleep(1)
except KeyboardInterrupt:
    send_color(0, 0, 0)
    spi.close()