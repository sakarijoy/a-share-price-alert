"use strict";

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = self.registration.scope;
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const page = windows.find((client) => client.url.startsWith(url));
    if (page) await page.focus();
    else await clients.openWindow(url);
  })());
});
