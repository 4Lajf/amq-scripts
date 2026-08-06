// ==UserScript==
// @name         AMQ Unfuck Song Library Scroll
// @namespace    https://github.com/4Lajf/amq-song-library-scroll-fix
// @version      1.0.0
// @description  Stops the Song Library list from jumping/skipping entries when an anime (or song) entry is expanded. Teaches Clusterize.js about variable row heights instead of assuming every row is the same height.
// @author       4Lajf
// @match        https://animemusicquiz.com/*
// @downloadURL  https://github.com/4Lajf/amq-scripts
// @updateURL    https://github.com/4Lajf/amq-scripts
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * WHY THE LIST JUMPS
 * ------------------
 * The library list is virtualized with Clusterize.js v1.0.0, which assumes every
 * row has the exact same height (`options.item_height`, sampled once from one row).
 * The rendered DOM is:
 *
 *     [keep-parity][top-space: rows_above * item_height][ ...80 real rows... ][bottom-space]
 *
 * When you expand "eX-Driver" that row becomes ~600px instead of 60px, but the
 * spacer maths still counts it as 60px. While the expanded row is inside the
 * rendered window its real height is in the flow, so everything below it sits
 * ~540px lower than Clusterize thinks. The moment you scroll far enough that the
 * cluster shifts and the expanded row drops out of the DOM, those 540px vanish
 * from the layout while `scrollTop` stays put -> the view snaps forward by several
 * entries. Scrolling back up re-inserts the row, the 540px come back, and you get
 * the same jump in reverse: the "janky" fight you described.
 *
 * WHAT THIS SCRIPT DOES
 * ---------------------
 * 1. Gives Clusterize a per-instance sparse map of "how much taller/shorter is row
 *    i than item_height", measured from the real DOM every time a cluster renders.
 *    The top/bottom spacers then include the extra height of the off-screen rows,
 *    so the total scrollable height and every row's scroll position stay constant
 *    whether or not the expanded row happens to be rendered. No more snapping.
 * 2. Converts scrollTop back into a "virtual" offset before picking the cluster
 *    index, so the correct rows are chosen once an expanded row is above you.
 * 3. Samples item_height from the most common row height instead of the middle
 *    row, so an expanded row can never poison the global row height on resize.
 * 4. Re-measures after CSS max-height transitions finish, so a row that is still
 *    animating open when the cluster changes doesn't get recorded at the wrong height.
 * 5. Restores an already-open entry instantly (no re-run of the 0.7s open
 *    animation) when it scrolls back into the rendered window.
 * 6. Fixes Library.handleEntryOpenClosed: it tried to compensate the scroll after
 *    force-closing the previously open entry, but read the layout before the 0.7s
 *    collapse animation had changed anything, so the compensation was always a
 *    no-op and the list drifted. Now it collapses instantly and compensates for real.
 *
 * Toggle at runtime with `window.amqLibraryScrollFix.enabled = false` (then reopen
 * the library) if you ever need to compare against stock behaviour.
 */

(function () {
	"use strict";

	const TAG = "[AMQ Library Scroll Fix]";
	const NO_TRANSITION_CLASS = "amqLibScrollFixNoTransition";

	const api = {
		version: "1.0.0",
		enabled: true,
		patched: { clusterize: false, library: false, entries: false },
		remeasure: null,
	};
	window.amqLibraryScrollFix = api;

	function log() {
		console.log.apply(console, [TAG].concat(Array.prototype.slice.call(arguments)));
	}

	// AMQ bundles its classes as top-level `class` declarations, which live in the
	// global *lexical* environment and never show up on `window`. A bare reference
	// resolves them through the scope chain; `window.X` is only the fallback.
	function resolveGlobal(name) {
		try {
			switch (name) {
				case "Clusterize":
					// eslint-disable-next-line no-undef
					if (typeof Clusterize !== "undefined") return Clusterize;
					break;
				case "Library":
					// eslint-disable-next-line no-undef
					if (typeof Library !== "undefined") return Library;
					break;
				case "LibraryAnimeEntry":
					// eslint-disable-next-line no-undef
					if (typeof LibraryAnimeEntry !== "undefined") return LibraryAnimeEntry;
					break;
				case "LibrarySongSoloEntry":
					// eslint-disable-next-line no-undef
					if (typeof LibrarySongSoloEntry !== "undefined") return LibrarySongSoloEntry;
					break;
			}
		} catch (e) {
			/* not defined yet */
		}
		return window[name];
	}

	function injectStyle() {
		const style = document.createElement("style");
		style.textContent =
			"." + NO_TRANSITION_CLASS + ", ." + NO_TRANSITION_CLASS + " * { transition: none !important; }";
		(document.head || document.documentElement).appendChild(style);
	}

	/* ------------------------------------------------------------------ *
	 * 1. Variable row height support for Clusterize
	 * ------------------------------------------------------------------ */

	function patchClusterize(Clusterize) {
		const proto = Clusterize.prototype;
		if (proto.__amqScrollFix) return false;
		proto.__amqScrollFix = true;

		const origGetRowsHeight = proto.getRowsHeight;
		const origInsertToDOM = proto.insertToDOM;

		function stateOf(inst) {
			if (!inst.__amqVH) {
				inst.__amqVH = {
					extras: Object.create(null), // row index -> px beyond item_height (may be negative)
					sortedKeys: null, // lazily rebuilt cache of Object.keys(extras)
					total: 0, // sum of all extras
					first: 0, // index of the first currently rendered row
					rowsRef: null,
					rowsLen: -1,
					itemHeight: -1,
					pending: false,
				};
			}
			return inst.__amqVH;
		}

		function resetExtras(st) {
			st.extras = Object.create(null);
			st.sortedKeys = null;
			st.total = 0;
		}

		function setExtra(st, index, value) {
			const current = st.extras[index] || 0;
			if (value === current) return;
			if (value === 0) {
				delete st.extras[index];
				st.sortedKeys = null;
			} else {
				if (!(index in st.extras)) st.sortedKeys = null;
				st.extras[index] = value;
			}
			st.total += value - current;
		}

		function extraKeys(st) {
			if (!st.sortedKeys) {
				st.sortedKeys = Object.keys(st.extras)
					.map(Number)
					.sort(function (a, b) {
						return a - b;
					});
			}
			return st.sortedKeys;
		}

		// Sum of extra height of every row strictly above `index`.
		function extraAbove(st, index) {
			if (!st.total) return 0;
			const keys = extraKeys(st);
			let sum = 0;
			for (let i = 0; i < keys.length && keys[i] < index; i++) sum += st.extras[keys[i]];
			return sum;
		}

		// Sum of extra height of every row from `index` onwards.
		function extraBelow(st, index) {
			if (!st.total) return 0;
			return st.total - extraAbove(st, index);
		}

		// Map a real scroll offset back onto the uniform-height coordinate system
		// Clusterize does its index maths in.
		function toVirtualTop(st, itemHeight, realTop) {
			if (!st.total) return realTop;
			const keys = extraKeys(st);
			let accumulated = 0;
			for (let i = 0; i < keys.length; i++) {
				const index = keys[i];
				const extra = st.extras[index];
				const rowTop = index * itemHeight + accumulated;
				if (realTop <= rowTop) break;
				const rowBottom = rowTop + itemHeight + extra;
				if (realTop >= rowBottom) {
					accumulated += extra;
					continue;
				}
				// Inside a variable-height row: clamp to somewhere within that row.
				return index * itemHeight + Math.max(0, Math.min(itemHeight, realTop - rowTop));
			}
			return realTop - accumulated;
		}

		function measuredHeight(node) {
			let height = node.offsetHeight;
			const style = window.getComputedStyle(node);
			// Mirrors Clusterize's own margin handling for non-table rows.
			const marginTop = parseInt(style.marginTop, 10) || 0;
			const marginBottom = parseInt(style.marginBottom, 10) || 0;
			return height + Math.max(marginTop, marginBottom);
		}

		function isSpacer(node, options) {
			const list = node.classList;
			if (!list) return false;
			return list.contains("clusterize-extra-row") || list.contains(options.no_data_class);
		}

		function measureRenderedRows(inst) {
			const st = stateOf(inst);
			const options = inst.options;
			const itemHeight = options.item_height;
			// The library builds its Clusterize while the page is still `.hide`,
			// where every offsetHeight reads 0. Recording that would corrupt every
			// row; Clusterize's own `refresh()` re-measures once the page is shown.
			if (!itemHeight || !inst.content_elem || !inst.content_elem.offsetHeight) return;
			if (options.tag === "tr") return;

			const children = inst.content_elem.children;
			let index = st.first;
			for (let i = 0; i < children.length; i++) {
				const node = children[i];
				if (isSpacer(node, options)) continue;
				setExtra(st, index, measuredHeight(node) - itemHeight);
				index++;
			}
		}

		function scheduleRemeasure(inst) {
			const st = stateOf(inst);
			if (st.pending) return;
			st.pending = true;
			window.requestAnimationFrame(function () {
				st.pending = false;
				if (!api.enabled) return;
				try {
					measureRenderedRows(inst);
				} catch (e) {
					console.error(TAG, "remeasure failed", e);
				}
			});
		}

		api.remeasure = function (inst) {
			if (inst && inst.content_elem) scheduleRemeasure(inst);
		};

		proto.getClusterNum = function (rows) {
			const options = this.options;
			options.scroll_top = this.scroll_elem.scrollTop;
			const span = options.cluster_height - options.block_height;
			if (!(span > 0)) return 0;

			const scrollTop = api.enabled
				? toVirtualTop(stateOf(this), options.item_height, options.scroll_top)
				: options.scroll_top;

			return Math.max(
				0,
				Math.min(
					Math.floor(scrollTop / span),
					Math.floor((rows.length * options.item_height) / span)
				)
			);
		};

		proto.generate = function (rows) {
			const options = this.options;
			const st = stateOf(this);
			const length = rows.length;

			if (length < options.rows_in_block) {
				st.first = 0;
				return {
					top_offset: 0,
					bottom_offset: 0,
					rows_above: 0,
					rows: length ? rows : this.generateEmptyRow(),
				};
			}

			const itemsStart = Math.max(
				(options.rows_in_cluster - options.rows_in_block) * this.getClusterNum(rows),
				0
			);
			const itemsEnd = itemsStart + options.rows_in_cluster;

			// The extra height of rows we are NOT rendering has to live in the
			// spacers, otherwise the total height changes as rows come and go.
			const topExtra = api.enabled ? extraAbove(st, itemsStart) : 0;
			const bottomExtra = api.enabled && itemsEnd < length ? extraBelow(st, itemsEnd) : 0;

			const topOffset = Math.max(itemsStart * options.item_height + topExtra, 0);
			const bottomOffset = Math.max((length - itemsEnd) * options.item_height + bottomExtra, 0);

			const clusterRows = [];
			let rowsAbove = itemsStart;
			if (topOffset < 1) rowsAbove++;
			for (let i = itemsStart; i < itemsEnd; i++) {
				if (rows[i]) clusterRows.push(rows[i]);
			}

			st.first = itemsStart;

			return {
				top_offset: topOffset,
				bottom_offset: bottomOffset,
				rows_above: rowsAbove,
				rows: clusterRows,
			};
		};

		// Stock Clusterize samples the middle rendered row. If that row happens to
		// be the expanded one, item_height explodes and the whole list geometry
		// goes with it. Use the most common row height instead.
		proto.getRowsHeight = function (rows) {
			const options = this.options;
			const st = stateOf(this);

			if (!api.enabled || options.tag === "tr") {
				const changed = origGetRowsHeight.call(this, rows);
				if (options.item_height !== st.itemHeight) {
					resetExtras(st);
					st.itemHeight = options.item_height;
				}
				return changed;
			}

			const previousHeight = options.item_height;
			options.cluster_height = 0;
			if (!rows.length) return;

			const children = this.content_elem.children;
			if (!children.length) return;

			const counts = Object.create(null);
			let best = null;
			let bestCount = 0;
			for (let i = 0; i < children.length; i++) {
				const node = children[i];
				if (isSpacer(node, options)) continue;
				const height = measuredHeight(node);
				const count = (counts[height] = (counts[height] || 0) + 1);
				if (count > bestCount) {
					bestCount = count;
					best = height;
				}
			}
			if (best === null) return;

			options.item_height = best;
			options.block_height = options.item_height * options.rows_in_block;
			options.rows_in_cluster = options.blocks_in_cluster * options.rows_in_block;
			options.cluster_height = options.blocks_in_cluster * options.block_height;

			if (options.item_height !== st.itemHeight) {
				resetExtras(st);
				st.itemHeight = options.item_height;
			}

			return previousHeight !== options.item_height;
		};

		proto.insertToDOM = function (rows, cache) {
			const st = stateOf(this);

			// A new/filtered rows array invalidates every recorded height.
			if (st.rowsRef !== rows || st.rowsLen !== rows.length) {
				resetExtras(st);
				st.rowsRef = rows;
				st.rowsLen = rows.length;
			}

			origInsertToDOM.call(this, rows, cache);

			if (!api.enabled) return;

			try {
				measureRenderedRows(this);
			} catch (e) {
				console.error(TAG, "measure failed", e);
			}

			// A row that is still mid open/close animation would be recorded at the
			// wrong height, so re-measure once the transition settles. Only rows
			// inside the rendered window can change here, and their heights never
			// feed the spacers, so this can never cause a re-render loop.
			if (!this.__amqTransitionHook && this.content_elem) {
				this.__amqTransitionHook = true;
				const self = this;
				this.content_elem.addEventListener(
					"transitionend",
					function (event) {
						if (event.propertyName === "max-height" || event.propertyName === "height") {
							scheduleRemeasure(self);
						}
					},
					true
				);
			}
		};

		return true;
	}

	/* ------------------------------------------------------------------ *
	 * 2. Correct scroll compensation when the previous entry is force-closed
	 * ------------------------------------------------------------------ */

	function patchLibrary(Library) {
		if (Library.prototype.__amqScrollFix) return false;
		Library.prototype.__amqScrollFix = true;

		Library.prototype.handleEntryOpenClosed = function (entry, open) {
			if (!open) {
				this.currentOpenEntry = null;
				return;
			}

			const previous = this.currentOpenEntry;
			if (api.enabled && previous && previous !== entry) {
				const scroller = this.$entryContainer && this.$entryContainer[0];
				const element = entry.$body && entry.$body[0];
				const $previousBody = previous.$body;
				const hasPrevious = $previousBody && $previousBody[0];

				// Measure the clicked entry, collapse the old one instantly (the
				// stock code measured before the 0.7s animation had moved anything,
				// so its compensation was always zero), then measure again.
				const before = scroller && element ? element.getBoundingClientRect().top : null;

				if (hasPrevious) $previousBody.addClass(NO_TRANSITION_CLASS);
				try {
					previous.forceClose();
				} finally {
					if (hasPrevious) {
						void $previousBody[0].offsetHeight; // force the collapse to apply now
						$previousBody.removeClass(NO_TRANSITION_CLASS);
					}
				}

				if (before !== null) {
					const delta = element.getBoundingClientRect().top - before;
					if (delta) scroller.scrollTop += delta;
				}

				if (this.clusterize && api.remeasure) api.remeasure(this.clusterize);
			} else if (previous && previous !== entry) {
				previous.forceClose();
			}

			this.currentOpenEntry = entry;
		};

		return true;
	}

	/* ------------------------------------------------------------------ *
	 * 3. Re-render an already-open entry at full height immediately
	 * ------------------------------------------------------------------ */

	function patchEntryRestore(LibraryAnimeEntry, LibrarySongSoloEntry) {
		let patched = false;

		if (LibraryAnimeEntry && !LibraryAnimeEntry.prototype.__amqScrollFix) {
			LibraryAnimeEntry.prototype.__amqScrollFix = true;
			const origSetup = LibraryAnimeEntry.prototype.setup;
			LibraryAnimeEntry.prototype.setup = function ($element, showExpand, searchCallback) {
				const restoring = api.enabled && this.open && this.extendedInfo && $element && $element.length;
				if (restoring) $element.addClass(NO_TRANSITION_CLASS);
				try {
					origSetup.call(this, $element, showExpand, searchCallback);
				} finally {
					if (restoring) {
						// The open state is applied inside setup(); settle it in the
						// same frame so the row is measured at its true height and
						// scrolling back up doesn't replay the expand animation.
						if (this.$infoContainer && this.$infoContainer.length) {
							this.$infoContainer.css("max-height", "fit-content");
						}
						void $element[0].offsetHeight;
						$element.removeClass(NO_TRANSITION_CLASS);
					}
				}
			};
			patched = true;
		}

		if (LibrarySongSoloEntry && !LibrarySongSoloEntry.prototype.__amqScrollFix) {
			LibrarySongSoloEntry.prototype.__amqScrollFix = true;
			const origSetup = LibrarySongSoloEntry.prototype.setup;
			LibrarySongSoloEntry.prototype.setup = function ($element, showExpand, searchCallback) {
				const restoring = api.enabled && this.open && this.extendedInfo && $element && $element.length;
				if (restoring) $element.addClass(NO_TRANSITION_CLASS);
				try {
					origSetup.call(this, $element, showExpand, searchCallback);
				} finally {
					if (restoring) {
						void $element[0].offsetHeight;
						$element.removeClass(NO_TRANSITION_CLASS);
					}
				}
			};
			patched = true;
		}

		return patched;
	}

	/* ------------------------------------------------------------------ *
	 * Bootstrap
	 * ------------------------------------------------------------------ */

	function tryPatch() {
		const Clusterize = resolveGlobal("Clusterize");
		const Library = resolveGlobal("Library");
		const LibraryAnimeEntry = resolveGlobal("LibraryAnimeEntry");
		const LibrarySongSoloEntry = resolveGlobal("LibrarySongSoloEntry");

		if (!Clusterize || !Clusterize.prototype || !Library || !Library.prototype) return false;

		try {
			api.patched.clusterize = patchClusterize(Clusterize) || api.patched.clusterize;
			api.patched.library = patchLibrary(Library) || api.patched.library;
			api.patched.entries =
				patchEntryRestore(LibraryAnimeEntry, LibrarySongSoloEntry) || api.patched.entries;
		} catch (e) {
			console.error(TAG, "failed to apply patches", e);
			return true; // don't keep retrying a broken patch
		}

		return true;
	}

	injectStyle();

	if (tryPatch()) {
		log("active (v" + api.version + ")");
	} else {
		// The game bundle may not have evaluated yet.
		let attempts = 0;
		const timer = setInterval(function () {
			attempts++;
			if (tryPatch()) {
				clearInterval(timer);
				log("active (v" + api.version + ")");
			} else if (attempts > 120) {
				clearInterval(timer);
				console.warn(TAG, "could not find Clusterize/Library - patch not applied");
			}
		}, 250);
	}
})();
