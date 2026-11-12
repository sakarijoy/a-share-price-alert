"use strict";

self.addEventListener("push", (event) => {
  let message;
  try {
    message = event.data?.json();
  } catch {
    message = null;
  }
  event.waitUntil(self.registration.showNotification(
    typeof message?.title === "string" ? message.title : "A 股到价提醒",
    {
      body: typeof message?.body === "string" ? message.body : "打开网页查看提醒。",
      icon: new URL("./icon-192.png", self.registration.scope).href,
      tag: typeof message?.tag === "string" ? message.tag : "stock-alert",
    },
  ));
});

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
