import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

function getImageUrl(node, depth = 0) {
    if (!node || depth > 5) return null;
    try {
        const output = app.node_outputs?.[node.id];
        if (output) {
            if (output.images && output.images.length > 0) {
                const img = output.images[0];
                return api.apiURL(`/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder)}`);
            }
            for (const key in output) {
                const slot = output[key];
                if (slot && slot.images && slot.images.length > 0) {
                    const img = slot.images[0];
                    return api.apiURL(`/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder)}`);
                }
            }
        }
        if (node.imgs && node.imgs.length > 0 && node.imgs[0].src) return node.imgs[0].src;
        const findWidget = (n) => (node.widgets || []).find(w => w.name === n || w.label === n);
        const imageWidget = findWidget("image") || findWidget("image_path") || findWidget("file_path");
        if (imageWidget && imageWidget.value) {
            const t = (node.type || "").toLowerCase(), c = (node.comfyClass || "").toLowerCase();
            const isLoad = t.includes("load") || c.includes("load");
            let filename = "", subfolder = "", type = isLoad ? "input" : "output";
            const val = imageWidget.value;
            if (typeof val === "string") {
                filename = val.trim().replace(/^"|"$/g, "");
                if (filename.includes("/") || filename.includes("\\")) {
                    const parts = filename.split(/[/\\]/);
                    filename = parts.pop(); subfolder = parts.join("/");
                }
            } else if (typeof val === "object" && val.filename) {
                filename = val.filename; subfolder = val.subfolder || "";
                type = val.type || type;
            }
            if (filename) return api.apiURL(`/view?filename=${encodeURIComponent(filename)}&type=${type}&subfolder=${encodeURIComponent(subfolder)}`);
        }
        const imageInput = (node.inputs || []).find(i => i.name.toLowerCase().includes("image") || i.type === "IMAGE");
        if (imageInput && imageInput.link) {
            const originNode = app.graph.getNodeById(app.graph.links[imageInput.link].origin_id);
            if (originNode) return getImageUrl(originNode, depth + 1);
        }
    } catch (e) { } return null;
}

const parseRatio = (r) => {
    if (!r) return 1; if (typeof r === 'number') return r;
    const s = String(r).replace(/\//g, ":"), p = s.split(":");
    return p.length === 2 ? (parseFloat(p[0]) / parseFloat(p[1]) || 1) : (parseFloat(s) || 1);
};

const TOOLTIPS = {
    "crop_left": { en: "Pixels to crop from the left edge", zh: "从左边缘剪裁的像素长度" },
    "crop_right": { en: "Pixels to crop from the right edge", zh: "从右边缘剪裁的像素长度" },
    "crop_top": { en: "Pixels to crop from the top edge", zh: "从上边缘剪裁的像素长度" },
    "crop_bottom": { en: "Pixels to crop from the bottom edge", zh: "从下边缘剪裁的像素长度" },
    "crop_current_width": { en: "Current width of the selection area", zh: "当前选区的宽度 (像素)" },
    "crop_current_height": { en: "Current height of the selection area", zh: "当前选区的高度 (像素)" },
    "aspect_ratio": { en: "Target aspect ratio (W:H) for the crop", zh: "剪裁的目标宽高比 (宽:高)" },
    "Ratio Presets": { en: "Quick presets for common aspect ratios", zh: "快速切换常用宽高比预设" },
    "ratio_lock": { en: "Maintain aspect ratio while resizing", zh: "开启后调整大小时将锁定比例" },
    "Full Image Crop": { en: "Expand crop to fit the whole image", zh: "全图自适应：在当前比例下扩至最大" },
    "No Crop": { en: "Reset selection to origin (1x1 pixel)", zh: "重置选区：恢复至初始 1x1 状态" },
    "Center Selection": { en: "Move current selection to image center", zh: "居中选区：保持大小并将位置移至中心" },
    "Apply Ratio & Center": { en: "Apply ratio and center the selection", zh: "应用比例并居中：强制重置选区为当前比例并居中" }
};

app.registerExtension({
    name: "FreeDragCrop.Antigravity",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "FreeDragCrop") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            const node = this;

            node.properties = node.properties || {};
            node.properties.dragStart = node.properties.dragStart || [0, 0];
            node.properties.dragEnd = node.properties.dragEnd || [512, 512];
            node.properties.actualImageWidth = 0;
            node.properties.actualImageHeight = 0;

            node.image = new Image();
            node.imageLoaded = false;
            node.dragging = false;
            node.dragMode = null;
            node._isSyncing = false;
            node.previewScale = 1.0;
            node.hoveredWidget = null;

            node.image.onload = () => {
                node.imageLoaded = true;
                node.setDirtyCanvas(true);
            };

            node.syncWidgetsFromProperties = function (force = false) {
                if (this._isSyncing && !force) return;
                const wasSyncing = this._isSyncing;
                this._isSyncing = true;
                try {
                    const find = (n) => this.widgets.find(w => w.name === n);
                    if (!this.imageLoaded || this.properties.actualImageWidth === 0) {
                        ["crop_left", "crop_right", "crop_top", "crop_bottom", "crop_current_width", "crop_current_height"].forEach(n => {
                            const w = find(n); if (w && w.value !== 0) w.value = 0;
                        });
                        return;
                    }
                    const [x1, y1] = this.properties.dragStart, [x2, y2] = this.properties.dragEnd;
                    const iw = this.properties.actualImageWidth, ih = this.properties.actualImageHeight;
                    const setIfChanged = (n, val) => {
                        const w = find(n);
                        if (w && Math.round(w.value) !== Math.round(val)) w.value = Math.round(val);
                    };
                    setIfChanged("crop_left", x1);
                    setIfChanged("crop_right", iw - x2);
                    setIfChanged("crop_top", y1);
                    setIfChanged("crop_bottom", ih - y2);
                    setIfChanged("crop_current_width", Math.abs(x2 - x1));
                    setIfChanged("crop_current_height", Math.abs(y2 - y1));
                } finally { this._isSyncing = wasSyncing; }
            };

            node.syncPropertiesFromWidgets = function () {
                if (this._isSyncing) return;
                this._isSyncing = true;
                try {
                    const find = (n) => this.widgets.find(w => w.name === n);
                    const iw = this.properties.actualImageWidth, ih = this.properties.actualImageHeight;
                    const l = find("crop_left")?.value || 0, r = find("crop_right")?.value || 0, t = find("crop_top")?.value || 0, b = find("crop_bottom")?.value || 0;
                    this.properties.dragStart = [l, t]; this.properties.dragEnd = [iw - r, ih - b];
                    this.setDirtyCanvas(true);
                } finally { this._isSyncing = false; }
            };

            node.applyAspectRatio = function (val) {
                if (this._isSyncing) return;
                this._isSyncing = true;
                try {
                    const iw = this.properties.actualImageWidth, ih = this.properties.actualImageHeight;
                    if (!iw) return;
                    const arWidget = this.widgets.find(w => w.name === "aspect_ratio");
                    if (val === "NoCrop") {
                        this.properties.dragStart = [0, 0];
                        this.properties.dragEnd = [1, 1];
                    } else if (val === "Full") {
                        if (arWidget) arWidget.value = `${iw}:${ih}`;
                        this.properties.dragStart = [0, 0]; this.properties.dragEnd = [iw, ih];
                    } else {
                        if (val && arWidget && val !== "Full" && val !== "NoCrop") arWidget.value = val;
                        const ratio = parseRatio(arWidget?.value || "1:1");
                        let nw, nh;
                        if (iw / ih > ratio) { nh = ih; nw = nh * ratio; } else { nw = iw; nh = nw / ratio; }
                        const nx = (iw - nw) / 2, ny = (ih - nh) / 2;
                        this.properties.dragStart = [Math.round(nx), Math.round(ny)];
                        this.properties.dragEnd = [Math.round(nx + nw), Math.round(ny + nh)];
                    }
                    this.syncWidgetsFromProperties(true);
                    this.setDirtyCanvas(true);
                } finally { this._isSyncing = false; }
            };

            node.onWidgetChanged = function (name, val) {
                if (this._isSyncing) return;
                const find = (n) => this.widgets.find(w => w.name === n);

                if (["crop_left", "crop_right", "crop_top", "crop_bottom"].includes(name)) {
                    const [ox1, oy1] = [...this.properties.dragStart], [ox2, oy2] = [...this.properties.dragEnd];
                    const ow = ox2 - ox1, oh = oy2 - oy1;

                    this.syncPropertiesFromWidgets();

                    const isLocked = find("ratio_lock")?.value;
                    if (isLocked) {
                        const [nx1, ny1] = this.properties.dragStart, [nx2, ny2] = this.properties.dragEnd;
                        const iw = this.properties.actualImageWidth, ih = this.properties.actualImageHeight;
                        let fx1 = nx1, fy1 = ny1, fx2 = nx2, fy2 = ny2;

                        if (name === "crop_left") { fx2 = fx1 + ow; fy1 = oy1; fy2 = oy2; }
                        else if (name === "crop_right") { fx1 = fx2 - ow; fy1 = oy1; fy2 = oy2; }
                        else if (name === "crop_top") { fy2 = fy1 + oh; fx1 = ox1; fx2 = ox2; }
                        else if (name === "crop_bottom") { fy1 = fy2 - oh; fx1 = ox1; fx2 = ox2; }

                        if (fx1 < 0) { fx2 -= fx1; fx1 = 0; } if (fy1 < 0) { fy2 -= fy1; fy1 = 0; }
                        if (fx2 > iw) { fx1 -= (fx2 - iw); fx2 = iw; } if (fy2 > ih) { fy1 -= (fy2 - ih); fy2 = ih; }

                        this.properties.dragStart = [Math.round(fx1), Math.round(fy1)];
                        this.properties.dragEnd = [Math.round(fx2), Math.round(fy2)];
                    }
                    this.syncWidgetsFromProperties(true);
                } else if (name === "crop_current_width" || name === "crop_current_height") {
                    const [x1, y1] = this.properties.dragStart, [x2, y2] = this.properties.dragEnd;
                    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
                    let nw = (name === "crop_current_width") ? val : Math.abs(x2 - x1);
                    let nh = (name === "crop_current_height") ? val : Math.abs(y2 - y1);

                    if (find("ratio_lock")?.value) {
                        const r = parseRatio(find("aspect_ratio")?.value || "1:1");
                        if (name === "crop_current_width") nh = nw / r; else nw = nh * r;
                    }

                    this.properties.dragStart = [Math.max(0, cx - nw / 2), Math.max(0, cy - nh / 2)];
                    this.properties.dragEnd = [this.properties.dragStart[0] + nw, this.properties.dragStart[1] + nh];
                    this.syncWidgetsFromProperties(true);
                } else if (name === "aspect_ratio") {
                    const preset = find("Ratio Presets");
                    if (preset && preset.value !== val) preset.value = preset.options.values.includes(val) ? val : "Custom";
                    this.applyAspectRatio(val);
                } else if (name === "ratio_lock") {
                    if (val) this.applyAspectRatio();
                }
            };

            node.onExecuted = function (message) {
                if (message?.images && message.images.length > 0) {
                    const img = message.images[0];
                    const url = api.apiURL(`/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder || "")}`);

                    if (message.orig_size) {
                        const [newW, newH] = message.orig_size;
                        const oldW = node.properties.actualImageWidth, oldH = node.properties.actualImageHeight;
                        node.properties.actualImageWidth = newW;
                        node.properties.actualImageHeight = newH;
                        if (newW !== oldW || newH !== oldH) node.applyAspectRatio("Full");
                    }
                    if (message.preview_scale) node.previewScale = Array.isArray(message.preview_scale) ? message.preview_scale[0] : message.preview_scale;

                    this.image.src = url; this.imageLoaded = false;
                    this.setDirtyCanvas(true);
                }
            };

            node.onDrawBackground = function () { if (this.dragging) return; };

            const canvasWidget = {
                type: "custom_canvas", name: "crop_preview",
                draw(ctx, node, width, y) {
                    const margin = 10, drawW = width - margin * 2, drawH = Math.max(150, node.size[1] - y - margin * 2);
                    const startY = y + margin;
                    ctx.fillStyle = "#161616"; ctx.fillRect(margin, startY, drawW, drawH);
                    if (!node.imageLoaded) { ctx.fillStyle = "#666"; ctx.textAlign = "center"; ctx.fillText("No Image", margin + drawW / 2, startY + drawH / 2); return; }
                    const imgAR = node.image.width / node.image.height, areaAR = drawW / drawH;
                    let pw, ph, px, py;
                    if (imgAR > areaAR) { pw = drawW; ph = drawW / imgAR; px = margin; py = startY + (drawH - ph) / 2; }
                    else { ph = drawH; pw = drawH * imgAR; px = margin + (drawW - pw) / 2; py = startY; }
                    ctx.drawImage(node.image, px, py, pw, ph);
                    const drawScale = pw / node.properties.actualImageWidth;
                    const [x1, y1] = node.properties.dragStart, [x2, y2] = node.properties.dragEnd;
                    const rx = px + x1 * drawScale, ry = py + y1 * drawScale, rw = (x2 - x1) * drawScale, rh = (y2 - y1) * drawScale;
                    ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.rect(rx, ry, rw, rh); ctx.fill("evenodd"); ctx.restore();
                    ctx.strokeStyle = "#0f0"; ctx.lineWidth = 2; ctx.strokeRect(rx, ry, rw, rh);
                    const realW = node.properties.actualImageWidth, realH = node.properties.actualImageHeight;
                    const realCropW = Math.round(x2 - x1), realCropH = Math.round(y2 - y1);
                    const perW = Math.round((realCropW / realW) * 100), perH = Math.round((realCropH / realH) * 100);
                    ctx.save(); ctx.font = "bold 14px Arial"; ctx.textAlign = "center"; ctx.shadowColor = "black"; ctx.shadowBlur = 4; ctx.fillStyle = "#aaff00";
                    ctx.fillText(`${perW} × ${perH} %`, px + pw / 2, py + ph / 2 + 5);
                    ctx.fillText(`${realCropW} × ${realCropH} px`, px + pw / 2, py + ph / 2 + 22);
                    ctx.restore();
                    node.previewArea = { x: px, y: py, width: pw, height: ph, scale: drawScale };

                    if (node.hoveredWidget && TOOLTIPS[node.hoveredWidget.name]) {
                        const tip = TOOLTIPS[node.hoveredWidget.name];
                        const textEn = tip.en;
                        const textZh = tip.zh;

                        ctx.save();
                        const fontHeight = 14;
                        ctx.font = `${fontHeight}px Arial`;
                        const mEn = ctx.measureText(textEn);
                        const mZh = ctx.measureText(textZh);
                        const boxW = Math.max(mEn.width, mZh.width) + 20;
                        const boxH = fontHeight * 2 + 25;
                        const bx = px + (pw - boxW) / 2;
                        const by = py + 10;

                        ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
                        ctx.strokeStyle = "#0f0";
                        ctx.lineWidth = 1;
                        // Rounded rect
                        const r = 5;
                        ctx.beginPath();
                        ctx.moveTo(bx + r, by);
                        ctx.lineTo(bx + boxW - r, by);
                        ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + r);
                        ctx.lineTo(bx + boxW, by + boxH - r);
                        ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH);
                        ctx.lineTo(bx + r, by + boxH);
                        ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - r);
                        ctx.lineTo(bx, by + r);
                        ctx.quadraticCurveTo(bx, by, bx + r, by);
                        ctx.closePath();
                        ctx.fill();
                        ctx.stroke();

                        ctx.fillStyle = "#fff";
                        ctx.textAlign = "center";
                        ctx.fillText(textEn, bx + boxW / 2, by + 20);
                        ctx.fillStyle = "#0f0";
                        ctx.fillText(textZh, bx + boxW / 2, by + 40);
                        ctx.restore();
                    }
                },
                computeSize(width) { return [width, -1]; }
            };

            node.addWidget("combo", "Ratio Presets", "Custom", (v) => {
                const ar = node.widgets.find(w => w.name === "aspect_ratio");
                if (ar && v !== "Custom") { ar.value = v; node.applyAspectRatio(v); }
            }, { values: ["1:1", "4:3", "3:4", "16:9", "9:16", "9:20", "2:3", "3:2", "21:9", "Custom"] });

            // Ratio Presets positioning
            const arIdx = node.widgets.findIndex(w => w.name === "aspect_ratio");
            if (arIdx !== -1) {
                const presetWidget = node.widgets.pop();
                node.widgets.splice(arIdx + 1, 0, presetWidget);
            }

            node.addWidget("button", "Full Image Crop", null, () => node.applyAspectRatio("Full"));
            node.addWidget("button", "No Crop", null, () => node.applyAspectRatio("NoCrop"));
            node.addWidget("button", "Center Selection", null, () => {
                const iw = node.properties.actualImageWidth, ih = node.properties.actualImageHeight;
                if (!iw) return;
                const [x1, y1] = node.properties.dragStart, [x2, y2] = node.properties.dragEnd;
                const cw = (x2 - x1), ch = (y2 - y1);
                const nx = Math.round((iw - cw) / 2), ny = Math.round((ih - ch) / 2);
                node.properties.dragStart = [nx, ny];
                node.properties.dragEnd = [nx + cw, ny + ch];
                node.syncWidgetsFromProperties(true); node.setDirtyCanvas(true);
            });
            node.addWidget("button", "Apply Ratio & Center", null, () => node.applyAspectRatio());
            node.addCustomWidget(canvasWidget);

            node.convertToImageSpace = function (pos) {
                if (!this.previewArea) return null;
                const p = this.previewArea;
                if (pos[0] < p.x || pos[0] > p.x + p.width || pos[1] < p.y || pos[1] > p.y + p.height) return null;
                return [(pos[0] - p.x) / p.scale, (pos[1] - p.y) / p.scale];
            };

            node.getHitArea = function (imgPos) {
                const [x1, y1] = this.properties.dragStart, [x2, y2] = this.properties.dragEnd;
                const [ix, iy] = imgPos, threshold = 15 / (this.previewArea?.scale || 1);
                const nearL = Math.abs(ix - x1) < threshold, nearR = Math.abs(ix - x2) < threshold;
                const nearT = Math.abs(iy - y1) < threshold, nearB = Math.abs(iy - y2) < threshold;
                const inX = ix > Math.min(x1, x2) && ix < Math.max(x1, x2), inY = iy > Math.min(y1, y2) && iy < Math.max(y1, y2);
                if (nearL && nearT) return "tl"; if (nearR && nearT) return "tr";
                if (nearL && nearB) return "bl"; if (nearR && nearB) return "br";
                if (nearT && inX) return "t"; if (nearB && inX) return "b";
                if (nearL && inY) return "l"; if (nearR && inY) return "r";
                if (inX && inY) return "move";
                return null;
            };

            node.onMouseDown = function (e, pos) {
                if (!this.imageLoaded) return false;
                const imgPos = this.convertToImageSpace(pos);
                if (imgPos) {
                    const hit = this.getHitArea(imgPos);
                    if (hit) {
                        this.dragging = true; this.dragMode = hit; this.dragStartImg = imgPos;
                        this.origStart = [...this.properties.dragStart]; this.origEnd = [...this.properties.dragEnd];
                        return true;
                    }
                }
                return false;
            };

            node.onMouseMove = function (e, pos) {
                const imgPos = this.convertToImageSpace(pos);
                if (!this.dragging) {
                    const hit = imgPos ? this.getHitArea(imgPos) : null;
                    const cursors = { move: "move", tl: "nwse-resize", br: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize", t: "ns-resize", b: "ns-resize", l: "ew-resize", r: "ew-resize" };
                    app.canvas.canvas.style.cursor = hit ? cursors[hit] : "default";

                    // Track hovered widget for tooltip
                    const oldHover = this.hoveredWidget;
                    this.hoveredWidget = null;
                    if (this.widgets) {
                        for (const w of this.widgets) {
                            if (w.last_y !== undefined && pos[1] >= w.last_y && pos[1] <= w.last_y + (w.computeSize?.()[1] || 20)) {
                                this.hoveredWidget = w;
                                break;
                            }
                        }
                    }
                    if (oldHover !== this.hoveredWidget) this.setDirtyCanvas(true);

                    return !!hit;
                }
                if (e.buttons === 0) { this.onMouseUp(e); return false; }
                if (!imgPos) return;
                const dx = imgPos[0] - this.dragStartImg[0], dy = imgPos[1] - this.dragStartImg[1];
                let [nx1, ny1] = [...this.origStart], [nx2, ny2] = [...this.origEnd];
                const iw = this.properties.actualImageWidth, ih = this.properties.actualImageHeight;
                const lock = this.widgets.find(wi => wi.name === "ratio_lock")?.value;
                const rat = lock ? parseRatio(this.widgets.find(wi => wi.name === "aspect_ratio")?.value || "1:1") : 1;
                if (this.dragMode === "move") {
                    const w = nx2 - nx1, h = ny2 - ny1;
                    nx1 = Math.max(0, Math.min(iw - w, nx1 + dx)); ny1 = Math.max(0, Math.min(ih - h, ny1 + dy));
                    nx2 = nx1 + w; ny2 = ny1 + h;
                } else {
                    if (this.dragMode.includes("l")) nx1 += dx; if (this.dragMode.includes("r")) nx2 += dx;
                    if (this.dragMode.includes("t")) ny1 += dy; if (this.dragMode.includes("b")) ny2 += dy;
                    if (lock) {
                        let nw = nx2 - nx1, nh = ny2 - ny1;
                        if (this.dragMode === "l" || this.dragMode === "r") {
                            const ow = this.origEnd[0] - this.origStart[0];
                            if (this.dragMode === "l") { nx1 = Math.max(0, Math.min(iw - ow, nx1)); nx2 = nx1 + ow; }
                            else { nx2 = Math.max(ow, Math.min(iw, nx2)); nx1 = nx2 - ow; }
                            ny1 = this.origStart[1]; ny2 = this.origEnd[1];
                        } else if (this.dragMode === "t" || this.dragMode === "b") {
                            const oh = this.origEnd[1] - this.origStart[1];
                            if (this.dragMode === "t") { ny1 = Math.max(0, Math.min(ih - oh, ny1)); ny2 = ny1 + oh; }
                            else { ny2 = Math.max(oh, Math.min(ih, ny2)); ny1 = ny2 - oh; }
                            nx1 = this.origStart[0]; nx2 = this.origEnd[0];
                        } else {
                            if (Math.abs(dx) * rat > Math.abs(dy)) { nh = nw / rat; if (this.dragMode.includes("t")) ny1 = ny2 - nh; else ny2 = ny1 + nh; }
                            else { nw = nh * rat; if (this.dragMode.includes("l")) nx1 = nx2 - nw; else nx2 = nx1 + nw; }
                            if (nx1 < 0) { const d = -nx1; nx1 = 0; if (this.dragMode.includes("t")) ny1 += d / rat; else ny2 -= d / rat; }
                            if (ny1 < 0) { const d = -ny1; ny1 = 0; if (this.dragMode.includes("l")) nx1 += d * rat; else nx2 -= d * rat; }
                            if (nx2 > iw) { const d = nx2 - iw; nx2 = iw; if (this.dragMode.includes("t")) ny1 += d / rat; else ny2 -= d / rat; }
                            if (ny2 > ih) { const d = ny2 - ih; ny2 = ih; if (this.dragMode.includes("l")) nx1 += d * rat; else nx2 -= d * rat; }
                        }
                    }
                }
                this.properties.dragStart = [Math.round(Math.max(0, Math.min(iw - 1, nx1))), Math.round(Math.max(0, Math.min(ih - 1, ny1)))];
                this.properties.dragEnd = [Math.round(Math.max(this.properties.dragStart[0] + 1, Math.min(iw, nx2))), Math.round(Math.max(this.properties.dragStart[1] + 1, Math.min(ih, ny2)))];
                this.syncWidgetsFromProperties(true); this.setDirtyCanvas(true);
                return true;
            };

            node.onMouseUp = function (e) {
                if (this.dragging) { this.dragging = false; this.dragMode = null; app.canvas.canvas.style.cursor = "default"; this.setDirtyCanvas(true); return true; }
                return false;
            };
        };
    },
    nodeCreated(node) {
        if (node.comfyClass !== "FreeDragCrop") return;
        const lock = node.widgets.find(w => w.name === "ratio_lock");
        if (lock) lock.value = true;
    }
});
