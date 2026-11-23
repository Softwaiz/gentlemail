/*
 * Keeps stories where they are, and out of the app. The app's forms post to the Worker and its links open pages; here
 * they would reach Storybook's own server, with whatever was typed. Server functions are faked
 * elsewhere (see ../vite.config.ts): this is for what the browser does by itself.
 */

/** Storybook's own links (docs pages) and links within the page. */
const isStorybooks = (url: URL) =>
  url.searchParams.has("path") || (url.hash !== "" && url.pathname === location.pathname && url.search === location.search);

function onSubmit(e: SubmitEvent) {
  // A form with its own handler, or a React action, has already stopped the browser from sending it.
  if (e.defaultPrevented) return;
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  console.info("[fake] submit", form.method, form.getAttribute("action") ?? ""); // never the values
}

function onClick(e: MouseEvent) {
  if (e.defaultPrevented) return;
  const link = e.composedPath().find((el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement && el.hasAttribute("href"));
  if (!link) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin || isStorybooks(url)) return;
  e.preventDefault();
  console.info("[fake] link", link.getAttribute("href"));
}

/** On window, so it runs after the component's own handlers, and covers menus and dialogs drawn outside the story. */
export function stayOnStory() {
  const w = window as typeof window & { __staysOnStory?: boolean };
  if (w.__staysOnStory) return; // the preview can load again when it's edited
  w.__staysOnStory = true;
  window.addEventListener("submit", onSubmit);
  window.addEventListener("click", onClick);
  // A middle click opens a link in a new tab, without a click event.
  window.addEventListener("auxclick", (e) => e.button === 1 && onClick(e));
  // Cookies are shared by every port of localhost: one set here (the theme) would reach the app running locally.
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => "",
    set: (cookie: string) => console.info("[fake] cookie", cookie.split("=")[0]),
  });
  // form.submit() raises no event (Log out uses it).
  HTMLFormElement.prototype.submit = function () {
    console.info("[fake] submit", this.method, this.getAttribute("action") ?? "");
  };
}
