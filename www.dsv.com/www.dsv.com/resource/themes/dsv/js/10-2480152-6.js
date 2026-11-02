"use strict";
(self.webpackChunk_schenker_dsv_theme = self.webpackChunk_schenker_dsv_theme || []).push([
    [10], {
        5247(e, n, t) {
            function o(e) {
                e.addEventListener("submit", a.bind(void 0, e))
            }

            function a(e, n) {
                n.preventDefault(), c(new FormData(e), e)
            }

            function c(e, n) {
                const t = new FormData,
                    o = [];
                e.forEach((e, n, a) => {
                    const c = o.filter(e => e[n]);
                    "query" === n || "page" === n ? t.append(n, e) : c.length > 0 ? c.forEach(t => t[n] = t[n].concat(e).sort()) : o.push({
                        [n]: [e]
                    })
                });
                const a = JSON.stringify(o),
                    c = btoa(a);
                t.append("formState", c);
                const r = new URLSearchParams(t),
                    s = n.action || window.location.href,
                    i = new URL(s);
                i.search = r.toString(), window.location.href = i.href
            }
            t.d(n, {
                M: () => c,
                setupEncoding: () => o
            })
        }
    }
]);