"use strict";
(self.webpackChunk_schenker_dsv_theme = self.webpackChunk_schenker_dsv_theme || []).push([
    [16], {
        9886(t, e, n) {
            function i(t, e = o) {
                t.endsWith(".css") ? function(t, e = o) {
                    const n = document.createElement("link");
                    n.media = "screen", n.rel = "stylesheet", n.href = t, e(n), document.head.appendChild(n)
                }(t, e) : function(t, e = o) {
                    const n = document.createElement("script");
                    n.defer = !0, n.type = "text/javascript", n.src = t, e(n), document.body.appendChild(n)
                }(t, e)
            }

            function o() {}
            n.d(e, {
                ChatbotAction: () => u,
                autoActivateChatbot: () => h
            });
            var a = n(2450),
                s = n(5564),
                r = (n(8101), n(6173));

            function h() {
                if (!window.location.search.replace("?", "").split(/[&=]/).includes("active-chat")) return;
                r.N.isAnyDialogOpened() ? r.N.addEventListener("dialog:all-closed", d, {
                    once: !0
                }) : d()
            }

            function d() {
                var t;
                const e = document.querySelector(".js-active-chat-dialog");
                e && (e.dispatchEvent(new MouseEvent("click", {
                    bubbles: !0
                })), null === (t = r.N.getFor(e.id)) || void 0 === t || t.open())
            }

            function l(t, e, n) {
                return (e = function(t) {
                    var e = function(t, e) {
                        if ("object" != typeof t || !t) return t;
                        var n = t[Symbol.toPrimitive];
                        if (void 0 !== n) {
                            var i = n.call(t, e || "default");
                            if ("object" != typeof i) return i;
                            throw new TypeError("@@toPrimitive must return a primitive value.")
                        }
                        return ("string" === e ? String : Number)(t)
                    }(t, "string");
                    return "symbol" == typeof e ? e : e + ""
                }(e)) in t ? Object.defineProperty(t, e, {
                    value: n,
                    enumerable: !0,
                    configurable: !0,
                    writable: !0
                }) : t[e] = n, t
            }
            const c = "hide";
            class u {
                constructor(t) {
                    l(this, "actionWrapper", void 0), l(this, "loader", void 0), l(this, "content", void 0), l(this, "openChatbotDialogButton", null), l(this, "openChatbotDialogBadge", null), l(this, "contentLoaded", !1), l(this, "loadingInitiated", !1), l(this, "lazyCode", void 0), l(this, "codeLeftToFinalize", new Set), l(this, "isOpened", !1), l(this, "showOpenButtonOnStart", !1), l(this, "currentChatID", null), l(this, "CHAT_ID_KEY", `chatbot-id-${this.getCurrentPathRoot()}`), this.actionWrapper = t, this.loader = a.q.createWithin(t), this.content = this.validateContent(t.querySelector(".js-chatbot-action__content")), this.openChatbotDialogButton = document.querySelector(".js-open-chatbot-dialog"), this.openChatbotDialogBadge = document.querySelector(".js-open-chatbot-dialog__badge"), this.actionWrapper.querySelectorAll('[type^="lazy"]').forEach(t => this.codeLeftToFinalize.add(t.src)), this.actionWrapper.querySelectorAll('[rel^="lazy"]').forEach(t => this.codeLeftToFinalize.add(t.href)), this.lazyCode = new Set(this.codeLeftToFinalize), this.actionWrapper.addEventListener("context-menu:activate", () => this.open()), this.actionWrapper.addEventListener("context-menu:deactivate", () => this.close()), this.actionWrapper.addEventListener("dialog:open", () => this.open()), this.actionWrapper.addEventListener("dialog:close", () => this.close()), this.showOpenButtonOnStart = null !== document.querySelector('meta[itemprop="show-open-button-on-start"]') || null !== sessionStorage.getItem(this.CHAT_ID_KEY), this.initChatID(), this.initOpenDialogButton(), this.listenToStartedConversation(), this.listenToTerminatedConversation(), this.listenToUnreadMessages()
                }
                open() {
                    this.isOpened || (this.isOpened = !0, this.notifyPotentialOpeningListeners(), this.showOpenChatbotDialogButton(), (0, s.Ls)(), this.loadingInitiated || this.initiateLoading())
                }
                close() {
                    this.isOpened && (this.notifyPotentialClosingListeners(), this.isOpened = !1, (0, s.Ef)())
                }
                initOpenDialogButton() {
                    this.showOpenButtonOnStart && this.showOpenChatbotDialogButton()
                }
                showOpenChatbotDialogButton() {
                    this.openChatbotDialogButton && (this.openChatbotDialogButton.classList.remove(c), (0, s.PM)())
                }
                notifyPotentialClosingListeners() {
                    this.contentLoaded && Array.from(this.content.children).forEach(t => t.dispatchEvent(new Event("hide")))
                }
                notifyPotentialOpeningListeners() {
                    this.contentLoaded && Array.from(this.content.children).forEach(t => {
                        t.dispatchEvent(new CustomEvent("show", {
                            detail: {
                                restoreSessionId: this.currentChatID
                            }
                        }))
                    })
                }
                listenToStartedConversation() {
                    Array.from(this.content.children).forEach(t => {
                        t.addEventListener("DA_onStartedConversation", t => {
                            this.setChatID(t.detail.eventData.sessionId)
                        })
                    })
                }
                listenToTerminatedConversation() {
                    Array.from(this.content.children).forEach(t => {
                        t.addEventListener("DA_onTerminatedConversation", t => {
                            this.setChatID(null)
                        })
                    })
                }
                listenToUnreadMessages() {
                    Array.from(this.content.children).forEach(t => {
                        t.addEventListener("DA_onUnreadMessages", t => {
                            this.updateUnreadMessages(t.detail.eventData.unreadMessagesCount)
                        })
                    })
                }
                initiateLoading() {
                    this.lazyCode.forEach(t => {
                        i(t, function(n) {
                            n.addEventListener("load", () => e(t)), n.addEventListener("error", () => e(t))
                        });
                        const e = this.loadingFinalized.bind(this)
                    }), this.loadingInitiated = !0, this.loader.activate()
                }
                loadingFinalized(t) {
                    this.codeLeftToFinalize.delete(t), this.resolveAllLoadings()
                }
                resolveAllLoadings() {
                    this.contentLoaded = 0 === this.codeLeftToFinalize.size, this.contentLoaded && this.loader.deactivate(), this.contentLoaded && this.isOpened && this.notifyPotentialOpeningListeners()
                }
                validateContent(t) {
                    if (t instanceof HTMLElement) return t;
                    throw Error("Missing content element for chatbot context action")
                }
                initChatID() {
                    this.setChatID(sessionStorage.getItem(this.CHAT_ID_KEY))
                }
                setChatID(t) {
                    this.currentChatID !== t && (this.currentChatID = t, t ? sessionStorage.setItem(this.CHAT_ID_KEY, t) : sessionStorage.removeItem(this.CHAT_ID_KEY))
                }
                updateUnreadMessages(t) {
                    this.openChatbotDialogBadge && (t > 0 ? (this.openChatbotDialogBadge.textContent = t.toString(), this.openChatbotDialogBadge.classList.remove(c)) : this.openChatbotDialogBadge.classList.add(c))
                }
                getCurrentPathRoot() {
                    return window.location.pathname.replace("/blueprint/servlet", "").split("/").filter(Boolean)[0] || ""
                }
            }
        }
    }
]);