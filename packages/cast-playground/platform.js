// The Cast platform, faked inside the receiver's page. On a device the
// framework talks to the platform over a WebSocket at
// ws://localhost:8008/v2/ipc. The playground's proxy puts this script first
// in the page's head, before the framework's, so that one socket leads to the
// window around the page, where the playground plays the platform and a
// sender. Every other socket, a dev server's included, is the real one.
//
// The page and the playground are on two origins. `data-parent` on the script
// names the playground's, and nothing is sent to or taken from another.
(() => {
  const parent = document.currentScript?.dataset.parent ?? window.location.origin;
  const Real = window.WebSocket;

  class PlatformSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 0;
      this.binaryType = 'blob';
      this.protocol = '';
      this.extensions = '';
      this.bufferedAmount = 0;
      this.receive = (event) => {
        if (event.origin !== parent || event.data?.source !== 'cast-sender') return;
        this.emit(new MessageEvent('message', { data: event.data.data }));
      };
      window.addEventListener('message', this.receive);
      setTimeout(() => {
        this.readyState = 1;
        this.emit(new Event('open'));
      }, 0);
    }

    /** The framework may set `onmessage` or add a listener. Both hear the event. */
    emit(event) {
      this[`on${event.type}`]?.(event);
      this.dispatchEvent(event);
    }

    send(data) {
      window.parent.postMessage({ source: 'cast-platform', data }, parent);
    }

    close() {
      window.removeEventListener('message', this.receive);
      this.readyState = 3;
      this.emit(new CloseEvent('close', { wasClean: true, code: 1000 }));
    }
  }
  for (const [name, value] of Object.entries({ CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })) {
    PlatformSocket[name] = value;
    PlatformSocket.prototype[name] = value;
  }

  window.WebSocket = new Proxy(Real, {
    construct(target, args) {
      return /localhost:8008/.test(String(args[0]))
        ? new PlatformSocket(String(args[0]))
        : new target(...args);
    },
  });
})();
