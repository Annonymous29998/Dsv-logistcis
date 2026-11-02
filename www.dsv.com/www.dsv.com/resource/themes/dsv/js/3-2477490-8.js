"use strict";
(self.webpackChunk_schenker_dsv_theme = self.webpackChunk_schenker_dsv_theme || []).push([
    [3], {
        396(e, t, s) {
            s.d(t, {
                SuggestionOverlay: () => o
            });
            var n = s(622),
                r = s(8172);

            function i(e, t, s) {
                return (t = function(e) {
                    var t = function(e, t) {
                        if ("object" != typeof e || !e) return e;
                        var s = e[Symbol.toPrimitive];
                        if (void 0 !== s) {
                            var n = s.call(e, t || "default");
                            if ("object" != typeof n) return n;
                            throw new TypeError("@@toPrimitive must return a primitive value.")
                        }
                        return ("string" === t ? String : Number)(e)
                    }(e, "string");
                    return "symbol" == typeof t ? t : t + ""
                }(t)) in e ? Object.defineProperty(e, t, {
                    value: s,
                    enumerable: !0,
                    configurable: !0,
                    writable: !0
                }) : e[t] = s, e
            }
            class o {
                constructor(e, t, s) {
                    i(this, "element", void 0), i(this, "input", void 0), i(this, "url", void 0), i(this, "list", void 0), i(this, "overlay", void 0), i(this, "currentIndex", -1), i(this, "previousSuggestions", []), this.element = e, this.input = t, this.url = s, this.overlay = document.createElement("div");
                    const o = document.createElement("div");
                    this.overlay.classList.add("control__suggestion-overlay"), this.overlay.tabIndex = -1, this.list = document.createElement("ol"), this.list.classList.add("reset-list"), this.overlay.appendChild(this.list), o.classList.add("control__loading-indicator"), e.appendChild(o), e.appendChild(this.overlay), t.addEventListener("focus", t => {
                        null === t.relatedTarget && this.previousSuggestions.length > 0 && e.classList.add("control--suggestion-overlay-open")
                    }), e.addEventListener("focusout", t => {
                        null !== t.relatedTarget && e.contains(t.relatedTarget) || this.closeOverlay()
                    }), t.addEventListener("input", (0, n.debounce)(500, () => {
                        const e = t.value.trim();
                        e.length < 3 ? this.closeOverlay() : (this.element.classList.add("control--loading"), this.getSuggestions(e).then(e => {
                            this.element.classList.add("control--suggestion-overlay-open"), this.previousSuggestions = e, this.currentIndex = -1, this.handleSuggestions(e), this.showKeyboardSelection(), this.removeError()
                        }).catch(() => {
                            this.handleSuggestions(this.previousSuggestions), this.setError((0, r.X)("form.suggestion.error"))
                        }).finally(() => {
                            this.element.classList.remove("control--loading"), this.element.classList.add("control--loaded-once")
                        }))
                    })), t.addEventListener("keydown", e => {
                        if (this.element.classList.contains("control--suggestion-overlay-open") && ("ArrowUp" === e.key && (e.preventDefault(), -1 !== this.currentIndex && (this.currentIndex = Math.max(0, this.currentIndex - 1), this.showKeyboardSelection())), "ArrowDown" === e.key && (e.preventDefault(), this.currentIndex = Math.min(this.list.children.length - 1, this.currentIndex + 1), this.showKeyboardSelection()), "Enter" === e.key && -1 !== this.currentIndex)) {
                            var t;
                            e.preventDefault();
                            const s = null === (t = this.list.children.item(this.currentIndex)) || void 0 === t ? void 0 : t.querySelector(".control__suggestion--active");
                            s && this.handleSelect(s.dataset.value || "")
                        }
                    })
                }
                showKeyboardSelection() {
                    var e;
                    const t = this.list.querySelector(".control__suggestion--active"),
                        s = null === (e = this.list.children.item(this.currentIndex)) || void 0 === e ? void 0 : e.querySelector(".control__suggestion");
                    t && t.classList.remove("control__suggestion--active"), s && (s.classList.add("control__suggestion--active"), this.overlay.scrollTop = Math.max(0, s.offsetTop - 100))
                }
                getSuggestions(e) {
                    return fetch(this.url.replace("{value}", encodeURIComponent(e))).then(e => e.json()).then(t => t.map(t => ({
                        value: t.term,
                        label: this.highlightSuggestion(t.term, e)
                    })))
                }
                highlightSuggestion(e, t) {
                    const s = t.split(/\s+/g);
                    let n = 0;
                    const r = e.charAt(0) === e.charAt(0).toUpperCase();
                    return e.split(/\s+/g).map(e => {
                        for (let t = n; t < s.length; t += 1) {
                            const i = s[t].toLowerCase();
                            if (e.toLowerCase().startsWith(i)) {
                                n += 1;
                                const t = r ? `<strong>${this.capitalizeFirstLetter(i)}</strong>` : `<strong>${i}</strong>`;
                                return e.toLowerCase().replace(i, t)
                            }
                        }
                        return e
                    }).join(" ")
                }
                capitalizeFirstLetter(e) {
                    return e.charAt(0).toUpperCase() + e.slice(1)
                }
                handleSuggestions(e) {
                    this.list.replaceChildren(...this.getChildren(e, e => {
                        this.handleSelect(e)
                    }))
                }
                handleSelect(e) {
                    this.input.value = e, this.closeOverlay(), this.input.focus()
                }
                closeOverlay() {
                    this.element.classList.remove("control--suggestion-overlay-open"), this.currentIndex = -1, this.showKeyboardSelection()
                }
                getChildren(e, t) {
                    if (e.length > 0) return e.map(e => {
                        const s = document.createElement("li"),
                            n = document.createElement("button");
                        return n.type = "button", n.classList.add("control__suggestion"), n.innerHTML = e.label, n.dataset.value = e.value, n.addEventListener("click", () => t(e.value)), s.appendChild(n), s
                    });
                    const s = document.createElement("li"),
                        n = document.createElement("div");
                    return n.classList.add("control__suggestion"), n.textContent = (0, r.X)(this.getNoResultsKey()), s.appendChild(n), [s]
                }
                setError(e) {
                    this.element.classList.add("has-error");
                    this.getErrorElement().textContent = e
                }
                removeError() {
                    this.element.classList.remove("has-error"), this.getErrorElement().remove()
                }
                getErrorElement() {
                    const e = this.element.nextElementSibling;
                    if (e && e.classList.contains("control__error-message")) return e;
                    const t = document.createElement("div");
                    return t.classList.add("control__error-message"), t.classList.add("control__error-message--floating"), this.element.parentElement && this.element.parentElement.insertBefore(t, this.element.nextSibling), t
                }
                getNoResultsKey() {
                    return "form.suggestion.no-results"
                }
            }
        }
    }
]);