"use strict";
(self.webpackChunk_schenker_dsv_theme = self.webpackChunk_schenker_dsv_theme || []).push([
    [12], {
        6125(e, r, n) {
            n.d(r, {
                setupParcelTrackingOverlay: () => o
            });
            var t = n(9735);

            function c(e, r) {
                const n = document.documentElement.lang,
                    t = new FormData(e).get("query");
                r.input.value = t, r.schenkerTrackingLink.href = `https://www.dsv.com/mydsv/tracking-public?refNumber=${t}&language_region=${n}`, r.trackingLink.href = `https://mydsv.com/track-shipment?query=${t}`
            }

            function i(e, r, n) {
                e.addEventListener("click", e => {
                    e.preventDefault(), ! function(e) {
                        const r = new FormData(e).get("query") || "";
                        return /\d{5}|\[a-zA-Z]\d{4}/.test(r)
                    }(r) ? r.submit() : ((0, t.D)("dialog-id-tracking-overlay"), c(r, n))
                })
            }

            function o() {
                ! function() {
                    const e = document.querySelector(".js-tracking-overlay");
                    if (!e) return void console.error("Tracking overlay missing.");
                    const r = e.querySelector("input"),
                        n = e.querySelector(".js-tracking-link"),
                        t = e.querySelector(".js-schenker-tracking-link");
                    if (!r || !n || !t) return void console.error("Tracking overlay missing required elements.");
                    const c = {
                        input: r,
                        trackingLink: n,
                        schenkerTrackingLink: t
                    };
                    document.querySelectorAll(".js-search-button").forEach((e, r, n) => {
                        const t = e.form;
                        t ? i(e, t, c) : console.error("Search button is not inside a form.")
                    })
                }(),
                function() {
                    const e = document.querySelector(".js-tracking-overlay-no-search");
                    if (!e) return void console.error("Tracking overlay missing.");
                    const r = e.querySelector("input"),
                        n = e.querySelector(".js-tracking-link"),
                        i = e.querySelector(".js-schenker-tracking-link");
                    if (!r || !n || !i) return void console.error("Tracking overlay missing required elements.");
                    const o = {
                        input: r,
                        trackingLink: n,
                        schenkerTrackingLink: i
                    };
                    document.querySelectorAll(".js-tracking-form").forEach(e => {
                        e.addEventListener("submit", function(r) {
                            r.preventDefault(), (0, t.D)("dialog-id-tracking-overlay-not-search"), c(e, o)
                        })
                    })
                }()
            }
        }
    }
]);