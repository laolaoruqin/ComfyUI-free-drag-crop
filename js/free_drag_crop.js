import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

function getImageUrl(node) {
    if (!node) return null;

    // 1. Priority: Use what the origin node is ALREADY showing (most reliable)
    if (node.imgs && node.imgs.length > 0 && node.imgs[0].src) {
        return node.imgs[0].src;
    }

    // 2. Secondary: Sniff for image widgets (handles cases where preview hasn't rendered yet)
    const imageWidget = node.widgets?.find(w => w.name === "image" || w.name === "image_path" || w.name === "file_path");
    if (imageWidget && imageWidget.value && typeof imageWidget.value === "string") {
        const typeWidget = node.widgets.find(w => w.name === "type");
        const type = typeWidget ? typeWidget.value : (node.type === "LoadImage" ? "input" : "output");
        return api.apiURL(`/view?filename=${encodeURIComponent(imageWidget.value)}&type=${type}&subfolder=`);
    }

    // 3. Last resort: internal state or fallback
    if (node.preview_src) return node.preview_src;
    if (node.image && node.image.src) return node.image.src;

    return null;
}

// Robust URL comparison to avoid infinite reloads
function isSameUrl(url1, url2) {
    if (!url1 || !url2) return url1 === url2;
    // Normalize both URLs to absolute before comparison
    const normalize = (u) => {
        try { return new URL(u, window.location.href).href; } catch (e) { return u; }
    };
    return normalize(url1) === normalize(url2);
}

// Utility to get and cache widgets for a node
function getCachedWidgets(node) {
    if (!node._widgetCache) {
        node._widgetCache = {};
        if (node.widgets) {
            for (const w of node.widgets) {
                node._widgetCache[w.name] = w;
            }
        }
    }
    return node._widgetCache;
}

const parseRatio = (ratioStr) => {
    if (!ratioStr) return 1;
    if (typeof ratioStr === 'number') return ratioStr;
    const s = String(ratioStr).replace(/\//g, ":");
    const parts = s.split(":");
    if (parts.length === 2) {
        const r = parseFloat(parts[0]) / parseFloat(parts[1]);
        return isNaN(r) ? 1 : r;
    }
    return parseFloat(s) || 1;
};

app.registerExtension({
    name: "FreeDragCrop.Antigravity",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "FreeDragCrop") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            const node = this;

            // Initialize properties (like OlmDragCrop)
            node.properties = node.properties || {};
            node.properties.dragStart = node.properties.dragStart || null;
            node.properties.dragEnd = node.properties.dragEnd || null;
            node.properties.actualImageWidth = 512;
            node.properties.actualImageHeight = 512;

            node.image = new Image();
            node.imageLoaded = false;
            node.dragging = false;

            node.image.onerror = (e) => {
                console.error("FreeDragCrop: Image failed to load", node.image.src);
                node.imageLoaded = false;
                node.setDirtyCanvas(true);
            };

            node.image.onload = () => {
                node.imageLoaded = true;
                const oldW = node.properties.actualImageWidth;
                const oldH = node.properties.actualImageHeight;
                const newW = node.image.width;
                const newH = node.image.height;

                node.properties.actualImageWidth = newW;
                node.properties.actualImageHeight = newH;

                // Reset or adjust crop if image size changed significantly or first load
                if (!node.properties.dragStart || oldW !== newW || oldH !== newH) {
                    node.properties.dragStart = [0, 0];
                    node.properties.dragEnd = [newW, newH];
                    node.syncWidgetsFromProperties();
                }
                node.setDirtyCanvas(true);
            };

            // Proactive update check: draw() in widget is only called when node is dirty.
            // onDrawBackground is called frequently by the canvas.
            node.onDrawBackground = function (ctx) {
                if (this.dragging) return;
                const linkId = this.inputs[0]?.link;
                if (linkId) {
                    const link = app.graph.links[linkId];
                    if (!link) return;
                    const origin = app.graph.getNodeById(link.origin_id);
                    if (!origin) return;

                    const url = getImageUrl(origin);
                    if (url && !isSameUrl(this.image.src, url)) {
                        this.image.src = url;
                        this.imageLoaded = false;
                        this.setDirtyCanvas(true);
                        console.log("FreeDragCrop: Loading new image from upstream", url);
                    } else if (url && !this.imageLoaded && this.image.complete) {
                        // RECOVERY: Image is done loading but state says it isn't
                        if (this.image.naturalWidth > 0) {
                            console.log("FreeDragCrop: Recovery - image complete but onload missed");
                            this.image.onload();
                        }
                    }
                }
            };

            const widget = {
                type: "custom_canvas",
                name: "crop_preview",
                draw(ctx, node, width, y) {
                    const margin = 10;
                    const topPadding = 5; // Extra space to avoid overlap with buttons
                    const drawW = width - margin * 2;
                    const drawH = Math.max(50, node.size[1] - y - margin * 2 - topPadding);
                    const startY = y + margin + topPadding;

                    // Image update is handled by onDrawBackground to be more proactive


                    // Background
                    ctx.fillStyle = "#222";
                    ctx.fillRect(margin, startY, drawW, drawH);

                    if (!node.imageLoaded) {
                        ctx.fillStyle = "#666";
                        ctx.textAlign = "center";
                        ctx.fillText("Loading image...", margin + drawW / 2, startY + drawH / 2);
                        return;
                    }

                    // Calculate preview area
                    const imgAR = node.image.width / node.image.height;
                    const areaAR = drawW / drawH;
                    let previewW, previewH, previewX, previewY;

                    if (imgAR > areaAR) {
                        previewW = drawW;
                        previewH = drawW / imgAR;
                        previewX = margin;
                        previewY = startY + (drawH - previewH) / 2;
                    } else {
                        previewH = drawH;
                        previewW = drawH * imgAR;
                        previewX = margin + (drawW - previewW) / 2;
                        previewY = startY;
                    }

                    const scale = previewW / node.image.width;
                    node.previewArea = { x: previewX, y: previewY, width: previewW, height: previewH, scale };

                    // Draw image
                    ctx.drawImage(node.image, previewX, previewY, previewW, previewH);

                    // Draw crop box if exists
                    if (node.properties.dragStart && node.properties.dragEnd) {
                        const [x1, y1] = node.properties.dragStart;
                        const [x2, y2] = node.properties.dragEnd;

                        const cropX = Math.min(x1, x2);
                        const cropY = Math.min(y1, y2);
                        const cropW = Math.abs(x2 - x1);
                        const cropH = Math.abs(y2 - y1);

                        const rx = previewX + cropX * scale;
                        const ry = previewY + cropY * scale;
                        const rw = cropW * scale;
                        const rh = cropH * scale;

                        // Darken outside
                        ctx.save();
                        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
                        ctx.beginPath();
                        ctx.rect(previewX, previewY, previewW, previewH);
                        ctx.rect(rx, ry, rw, rh);
                        ctx.fill("evenodd");
                        ctx.restore();

                        // Crop box border
                        ctx.strokeStyle = "#0f0";
                        ctx.lineWidth = 2;
                        ctx.strokeRect(rx, ry, rw, rh);

                        // Draw 8 handles
                        const hs = 6;
                        const handles = [
                            [0, 0], [1, 0], [0, 1], [1, 1],
                            [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]
                        ];

                        ctx.fillStyle = "#fff";
                        ctx.strokeStyle = "#0f0";
                        handles.forEach(([px, py]) => {
                            const hx = rx + rw * px - hs / 2;
                            const hy = ry + rh * py - hs / 2;
                            ctx.fillRect(hx, hy, hs, hs);
                            ctx.strokeRect(hx, hy, hs, hs);
                        });

                        // Info text
                        if (rw > 50 && rh > 20) {
                            ctx.fillStyle = "#fff";
                            ctx.font = "bold 11px sans-serif";
                            ctx.textAlign = "center";
                            ctx.fillText(`${Math.round(cropW)} × ${Math.round(cropH)}`, rx + rw / 2, ry + rh / 2 + 4);
                        }
                    }
                },
                computeSize(width) {
                    return [width, -1];
                }
            };


            // Clear cache when widgets change (unlikely to happen dynamically but safe)
            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                onConfigure?.apply(this, arguments);
                this._widgetCache = null;
            };

            // Mouse handling (following OlmDragCrop pattern)
            node.onMouseDown = function (e, pos) {
                if (!this.previewArea || !this.imageLoaded) return false;

                const local = this.convertToImageSpace(pos);
                if (!local) return false;

                const hit = this.getCropBoxHitArea(local);
                if (hit) {
                    this.dragging = true;
                    this.dragMode = hit;
                    this.dragStartPos = local;
                    this.originalDragStart = [...this.properties.dragStart];
                    this.originalDragEnd = [...this.properties.dragEnd];
                    this.setDirtyCanvas(true);
                    return true;
                }
                return false;
            };

            node.onMouseMove = function (e, pos) {
                if (!this.previewArea || !this.imageLoaded) return false;

                // Simple throttling or early exit for hover cursor
                if (!this.dragging) {
                    const local = this.convertToImageSpace(pos);
                    if (!local) return false;
                    const hit = this.getCropBoxHitArea(local);
                    const cursors = {
                        move: "move", "top-left": "nwse-resize", "bottom-right": "nwse-resize",
                        "top-right": "nesw-resize", "bottom-left": "nesw-resize",
                        top: "ns-resize", bottom: "ns-resize", left: "ew-resize", right: "ew-resize"
                    };
                    app.canvas.canvas.style.cursor = hit ? cursors[hit] : "default";
                    return !!hit;
                }

                // DRAGGING LOGIC
                if (this.dragging && (!e.buttons || e.buttons === 0)) {
                    this.dragging = false;
                    this.syncWidgetsFromProperties();
                    this.setDirtyCanvas(true);
                    return false;
                }

                const local = this.convertToImageSpace(pos);
                if (local) {
                    this.updateCropFromDrag(local);
                    this.setDirtyCanvas(true);
                    return true;
                }

                return false;
            };

            node.onMouseUp = function (e, pos) {
                if (this.dragging) {
                    this.dragging = false;
                    this.syncWidgetsFromProperties();
                    this.setDirtyCanvas(true);
                    return true;
                }
                return false;
            };

            // Helper functions (following OlmDragCrop pattern)
            node.convertToImageSpace = function (canvasPos) {
                if (!this.previewArea) return null;
                const p = this.previewArea;
                const x = (canvasPos[0] - p.x) / p.scale;
                const y = (canvasPos[1] - p.y) / p.scale;
                return [x, y];
            };

            node.getCropBoxHitArea = function (pos) {
                if (!this.properties.dragStart || !this.properties.dragEnd) return null;

                const [x1, y1] = this.properties.dragStart;
                const [x2, y2] = this.properties.dragEnd;
                const cropX = Math.min(x1, x2);
                const cropY = Math.min(y1, y2);
                const cropW = Math.abs(x2 - x1);
                const cropH = Math.abs(y2 - y1);

                const threshold = 12;
                const [px, py] = pos;

                const nearLeft = Math.abs(px - cropX) < threshold;
                const nearRight = Math.abs(px - (cropX + cropW)) < threshold;
                const nearTop = Math.abs(py - cropY) < threshold;
                const nearBottom = Math.abs(py - (cropY + cropH)) < threshold;
                const insideX = px >= cropX && px <= cropX + cropW;
                const insideY = py >= cropY && py <= cropY + cropH;

                if (nearLeft && nearTop) return "top-left";
                if (nearRight && nearTop) return "top-right";
                if (nearLeft && nearBottom) return "bottom-left";
                if (nearRight && nearBottom) return "bottom-right";
                if (nearTop && insideX) return "top";
                if (nearBottom && insideX) return "bottom";
                if (nearLeft && insideY) return "left";
                if (nearRight && insideY) return "right";
                if (insideX && insideY) return "move";
                return null;
            };

            node.updateCropFromDrag = function (currentPos) {
                const dx = currentPos[0] - this.dragStartPos[0];
                const dy = currentPos[1] - this.dragStartPos[1];

                let [x1, y1] = this.originalDragStart;
                let [x2, y2] = this.originalDragEnd;

                const iw = this.properties.actualImageWidth;
                const ih = this.properties.actualImageHeight;
                const widgets = getCachedWidgets(this);

                if (this.dragMode === "move") {
                    const w = x2 - x1;
                    const h = y2 - y1;
                    x1 = Math.max(0, Math.min(iw - w, x1 + dx));
                    y1 = Math.max(0, Math.min(ih - h, y1 + dy));
                    x2 = x1 + w;
                    y2 = y1 + h;
                } else {
                    if (this.dragMode.includes("left")) x1 = Math.max(0, Math.min(x2 - 1, x1 + dx));
                    if (this.dragMode.includes("right")) x2 = Math.max(x1 + 1, Math.min(iw, x2 + dx));
                    if (this.dragMode.includes("top")) y1 = Math.max(0, Math.min(y2 - 1, y1 + dy));
                    if (this.dragMode.includes("bottom")) y2 = Math.max(y1 + 1, Math.min(ih, y2 + dy));

                    // Apply aspect ratio lock
                    const lockWidget = widgets["ratio_lock"];
                    if (lockWidget && lockWidget.value) {
                        const ratioWidget = widgets["aspect_ratio"];
                        const ratio = parseRatio(ratioWidget ? ratioWidget.value : "1:1");
                        const w = x2 - x1;
                        const h = y2 - y1;

                        if (this.dragMode.includes("left") || this.dragMode.includes("right")) {
                            const newH = w / ratio;
                            y2 = y1 + newH;
                            if (y2 > ih) {
                                y2 = ih;
                                const constrainedH = y2 - y1;
                                const constrainedW = constrainedH * ratio;
                                if (this.dragMode.includes("left")) { x1 = x2 - constrainedW; } else { x2 = x1 + constrainedW; }
                            }
                        } else {
                            const newW = h * ratio;
                            x2 = x1 + newW;
                            if (x2 > iw) {
                                x2 = iw;
                                const constrainedW = x2 - x1;
                                const constrainedH = constrainedW / ratio;
                                if (this.dragMode.includes("top")) { y1 = y2 - constrainedH; } else { y2 = y1 + constrainedH; }
                            }
                        }
                    }
                }

                this.properties.dragStart = [x1, y1];
                this.properties.dragEnd = [x2, y2];

                // Performance: only real-time sync if moving, or just sync at end.
                // For better feel, we update the canvas immediately and widgets periodically or at end.
                // Let's try skipping widget sync during fast movement, or use cached widgets.
                this.syncWidgetsFromProperties();
            };

            node.syncWidgetsFromProperties = function () {
                if (!this.properties.dragStart || !this.properties.dragEnd) return;

                const [x1, y1] = this.properties.dragStart;
                const [x2, y2] = this.properties.dragEnd;
                const iw = this.properties.actualImageWidth;
                const ih = this.properties.actualImageHeight;

                const cropLeft = Math.min(x1, x2);
                const cropTop = Math.min(y1, y2);
                const cropRight = iw - Math.max(x1, x2);
                const cropBottom = ih - Math.max(y1, y2);

                const widgets = getCachedWidgets(this);

                this._isSyncing = true;
                if (widgets["crop_left"]) widgets["crop_left"].value = Math.round(cropLeft);
                if (widgets["crop_right"]) widgets["crop_right"].value = Math.round(cropRight);
                if (widgets["crop_top"]) widgets["crop_top"].value = Math.round(cropTop);
                if (widgets["crop_bottom"]) widgets["crop_bottom"].value = Math.round(cropBottom);
                this._isSyncing = false;
            };

            node.syncPropertiesFromWidgets = function () {
                const widgets = getCachedWidgets(this);
                const iw = this.properties.actualImageWidth;
                const ih = this.properties.actualImageHeight;

                const left = widgets["crop_left"]?.value || 0;
                const right = widgets["crop_right"]?.value || 0;
                const top = widgets["crop_top"]?.value || 0;
                const bottom = widgets["crop_bottom"]?.value || 0;

                this.properties.dragStart = [left, top];
                this.properties.dragEnd = [iw - right, ih - bottom];
                this.setDirtyCanvas(true);
            };

            node.onWidgetChanged = function (name, value) {
                if (!this.imageLoaded || this.dragging || this._isSyncing) return;

                if (["crop_left", "crop_right", "crop_top", "crop_bottom"].includes(name)) {
                    this.syncPropertiesFromWidgets();
                } else if (name === "aspect_ratio") {
                    this.applyAspectRatio(value);
                }
            };

            node.applyAspectRatio = function (val) {
                if (!this.imageLoaded) return;
                const iw = this.image.width;
                const ih = this.image.height;
                const ratio = parseRatio(val || this.widgets.find(w => w.name === "aspect_ratio")?.value || "1:1");

                let cropW, cropH;
                if (iw / ih > ratio) {
                    cropH = ih * 0.8;
                    cropW = cropH * ratio;
                } else {
                    cropW = iw * 0.8;
                    cropH = cropW / ratio;
                }

                const x = (iw - cropW) / 2;
                const y = (ih - cropH) / 2;

                this.properties.dragStart = [x, y];
                this.properties.dragEnd = [x + cropW, y + cropH];
                this.syncWidgetsFromProperties();
                this.setDirtyCanvas(true);
            };

            // 1. BUTTONS FIRST (So they appear above the preview and y is correct)
            node.addWidget("button", "Reset: Full Image", null, () => {
                if (node.imageLoaded) {
                    node.properties.dragStart = [0, 0];
                    node.properties.dragEnd = [node.image.width, node.image.height];
                    node.syncWidgetsFromProperties();
                    node.setDirtyCanvas(true);
                }
            });

            node.addWidget("button", "Center Current Selection", null, () => {
                if (node.imageLoaded && node.properties.dragStart && node.properties.dragEnd) {
                    const [x1, y1] = node.properties.dragStart;
                    const [x2, y2] = node.properties.dragEnd;
                    const cropW = Math.abs(x2 - x1);
                    const cropH = Math.abs(y2 - y1);
                    const iw = node.image.width;
                    const ih = node.image.height;

                    const newX = (iw - cropW) / 2;
                    const newY = (ih - cropH) / 2;

                    node.properties.dragStart = [newX, newY];
                    node.properties.dragEnd = [newX + cropW, newY + cropH];
                    node.syncWidgetsFromProperties();
                    node.setDirtyCanvas(true);
                }
            });

            node.addWidget("button", "Apply Ratio & Center", null, () => {
                node.applyAspectRatio();
            });

            // 2. PREVIEW WIDGET LAST (Takes all remaining space)
            node.addCustomWidget(widget);

            node.size = [400, 600];
        };
    }
});
