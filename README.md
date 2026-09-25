Проект интерактивной настольной игры для Raspberry Pi Zero 2 W.

## Запуск

Нужен Node.js LTS 18 или новее.

```bash
npm install
npm start
```

Сервер слушает порт 3000 на всех интерфейсах.

- Игрок: http://localhost:3000/
- Экран ТВ: http://localhost:3000/tv
- Ведущий: http://localhost:3000/admin

Пароль ведущего задаётся константой `ADMIN_PASSWORD` в `server.js` (сейчас `admin`). После входа в браузере сохраняется сессионный токен, не пароль.

Клиент Socket.io отдаёт сам сервер с `/socket.io/socket.io.js`. Внешние CDN не используются.

На плате откройте те же адреса по имени хоста, например `http://PartyBox.local:3000/`.
