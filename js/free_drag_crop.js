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

const HELP_DESCRIPTIONS = [
    { icon: "⬅️", name: "Left Crop", zh: "左剪裁", desc: "Remove pixels from the left side", zh_desc: "从左侧剪裁像素" },
    { icon: "➡️", name: "Right Crop", zh: "右剪裁", desc: "Remove pixels from the right side", zh_desc: "从右侧剪裁像素" },
    { icon: "⬆️", name: "Top Crop", zh: "上剪裁", desc: "Remove pixels from the top", zh_desc: "从顶部剪裁" },
    { icon: "⬇️", name: "Bottom Crop", zh: "下剪裁", desc: "Remove pixels from the bottom", zh_desc: "从底部剪裁" },
    { icon: "↔️", name: "Current Width", zh: "当前宽度", desc: "The width of the selection box in pixels", zh_desc: "当前选区的宽度（像素）" },
    { icon: "↕️", name: "Current Height", zh: "当前高度", desc: "The height of the selection box in pixels", zh_desc: "当前选区的高度（像素）" },
    { icon: "📐", name: "Aspect Ratio", zh: "宽高比", desc: "Set a specific width-to-height ratio", zh_desc: "设置特定的宽高比例" },
    { icon: "📄", name: "Presets", zh: "预设", desc: "Quickly apply standard aspect ratios", zh_desc: "快速应用标准宽高比" },
    { icon: "🔒", name: "Ratio Lock", zh: "锁定比例", desc: "Maintain the aspect ratio during resize", zh_desc: "调整大小时保持宽高比" },
    { icon: "🖼️", name: "Selected Full", zh: "全图", desc: "Reset selection to cover the entire image", zh_desc: "重置选区以覆盖全图" },
    { icon: "🔄", name: "Reset", zh: "重置", desc: "Reset selection to a minimal 1x1 size", zh_desc: "将选区重置为 1x1 大小" },
    { icon: "🎯", name: "Center", zh: "居中", desc: "Move the current selection box to the center", zh_desc: "将当前选区移动到中心" },
    { icon: "✅", name: "Apply", zh: "应用", desc: "Enforce current ratio and center logic", zh_desc: "强制执行当前的比例和对齐逻辑" }
];

app.registerExtension({
    name: "FreeDragCrop.Antigravity",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "FreeDragCrop") return;

        const proto = nodeType.prototype;
        const onNodeCreated = proto.onNodeCreated;

        proto.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            this._initNode();
        };

        // --- Core Initialization ---
        proto._initNode = function () {
            this.properties = this.properties || {};
            this.properties.dragStart = this.properties.dragStart || [0, 0];
            this.properties.dragEnd = this.properties.dragEnd || [512, 512];
            this.properties.actualImageWidth = 0;
            this.properties.actualImageHeight = 0;

            this.image = new Image();
            this.imageLoaded = false;
            this.dragging = false;
            this.dragMode = null;
            this._isSyncing = false;
            this.previewScale = 1.0;
            this.isHoveringHelp = false;

            this.image.onload = () => {
                this.imageLoaded = true;
                this.setDirtyCanvas(true);
            };

            this._setupWidgets();
        };

        proto._setupWidgets = function () {
            const node = this;

            // Preset Dropdown logic
            node.addWidget("combo", "Ratio Presets", "Custom", (v) => {
                const ar = node.widgets.find(w => w.name === "aspect_ratio");
                if (ar && v !== "Custom") {
                    ar.value = v;
                    node.applyAspectRatio(v);
                }
            }, { values: ["1:1", "4:3", "3:4", "16:9", "9:16", "9:20", "2:3", "3:2", "21:9", "Custom"] });

            // Move Preset widget below aspect_ratio
            const arIdx = node.widgets.findIndex(w => w.name === "aspect_ratio");
            if (arIdx !== -1) {
                const presetWidget = node.widgets.pop();
                node.widgets.splice(arIdx + 1, 0, presetWidget);
            }

            node.addWidget("button", "Full Image Crop", null, () => node.applyAspectRatio("Full"));
            node.addWidget("button", "No Crop", null, () => node.applyAspectRatio("NoCrop"));
            node.addWidget("button", "Center Selection", null, () => node.centerSelection());
            node.addWidget("button", "Apply Ratio & Center", null, () => node.applyAspectRatio());

            const canvasWidget = {
                type: "custom_canvas", name: "crop_preview",
                draw: (ctx, node, width, y) => this._drawPreviewCanvas(ctx, node, width, y),
                computeSize: (width) => [width, -1]
            };
            node.addCustomWidget(canvasWidget);
        };

        // --- Synchronization Logic ---
        proto.syncWidgetsFromProperties = function (force = false) {
            if (this._isSyncing && !force) return;
            const wasSyncing = this._isSyncing;
            this._isSyncing = true;
            try {
                const find = (n) => this.widgets.find(w => w.name === n);
                const imgW = this.properties.actualImageWidth, imgH = this.properties.actualImageHeight;

                if (!this.imageLoaded || imgW === 0) {
                    ["crop_left", "crop_right", "crop_top", "crop_bottom", "crop_current_width", "crop_current_height"].forEach(n => {
                        const w = find(n); if (w && w.value !== 0) w.value = 0;
                    });
                    return;
                }

                const [x1, y1] = this.properties.dragStart, [x2, y2] = this.properties.dragEnd;
                const setIfChanged = (n, val) => {
                    const w = find(n);
                    if (w && Math.round(w.value) !== Math.round(val)) w.value = Math.round(val);
                };

                setIfChanged("crop_left", x1);
                setIfChanged("crop_right", imgW - x2);
                setIfChanged("crop_top", y1);
                setIfChanged("crop_bottom", imgH - y2);

                const curW = Math.abs(x2 - x1), curH = Math.abs(y2 - y1);
                setIfChanged("crop_current_width", curW);
                setIfChanged("crop_current_height", curH);

                // Sync Labels & Presets
                const arWidget = find("aspect_ratio"), lockWidget = find("ratio_lock"), presetWidget = find("Ratio Presets");

                if (arWidget && (!lockWidget || !lockWidget.value)) {
                    const newAR = `${Math.round(curW)}:${Math.round(curH)}`;
                    if (arWidget.value !== newAR) arWidget.value = newAR;
                }

                if (presetWidget && arWidget) {
                    const boxRatio = curW / curH;
                    const textRatio = parseRatio(arWidget.value);
                    if (Math.abs(boxRatio - textRatio) > 0.01) {
                        presetWidget.value = "Custom";
                    } else {
                        presetWidget.value = presetWidget.options.values.includes(arWidget.value) ? arWidget.value : "Custom";
                    }
                }
            } finally { this._isSyncing = wasSyncing; }
        };

        proto.syncPropertiesFromWidgets = function () {
            if (this._isSyncing) return;
            this._isSyncing = true;
            try {
                const find = (n) => this.widgets.find(w => w.name === n);
                const imgW = this.properties.actualImageWidth, imgH = this.properties.actualImageHeight;
                const l = find("crop_left")?.value || 0, r = find("crop_right")?.value || 0;
                const t = find("crop_top")?.value || 0, b = find("crop_bottom")?.value || 0;
                this.properties.dragStart = [l, t];
                this.properties.dragEnd = [imgW - r, imgH - b];
                this.setDirtyCanvas(true);
            } finally { this._isSyncing = false; }
        };

        proto.applyAspectRatio = function (val) {
            if (this._isSyncing) return;
            this._isSyncing = true;
            try {
                const imgW = this.properties.actualImageWidth, imgH = this.properties.actualImageHeight;
                if (!imgW) return;
                const arWidget = this.widgets.find(w => w.name === "aspect_ratio");
                const lockWidget = this.widgets.find(w => w.name === "ratio_lock");

                if (val === "NoCrop") {
                    if (arWidget) arWidget.value = "1:1";
                    if (lockWidget) lockWidget.value = false;
                    this.properties.dragStart = [0, 0]; this.properties.dragEnd = [1, 1];
                } else if (val === "Full") {
                    if (arWidget) arWidget.value = `${imgW}:${imgH}`;
                    if (lockWidget) lockWidget.value = false;
                    this.properties.dragStart = [0, 0]; this.properties.dragEnd = [imgW, imgH];
                } else {
                    if (val && arWidget && val !== "Full" && val !== "NoCrop") arWidget.value = val;
                    const ratio = parseRatio(arWidget?.value || "1:1");
                    let nw, nh;
                    if (imgW / imgH > ratio) { nh = imgH; nw = nh * ratio; } else { nw = imgW; nh = nw / ratio; }
                    const nx = (imgW - nw) / 2, ny = (imgH - nh) / 2;
                    this.properties.dragStart = [Math.round(nx), Math.round(ny)];
                    this.properties.dragEnd = [Math.round(nx + nw), Math.round(ny + nh)];
                }
                this.syncWidgetsFromProperties(true);
                this.setDirtyCanvas(true);
            } finally { this._isSyncing = false; }
        };

        proto.centerSelection = function () {
            const imgW = this.properties.actualImageWidth, imgH = this.properties.actualImageHeight;
            if (!imgW) return;
            const [x1, y1] = this.properties.dragStart, [x2, y2] = this.properties.dragEnd;
            const cw = x2 - x1, ch = y2 - y1;
            const nx = Math.round((imgW - cw) / 2), ny = Math.round((imgH - ch) / 2);
            this.properties.dragStart = [nx, ny];
            this.properties.dragEnd = [nx + cw, ny + ch];
            this.syncWidgetsFromProperties(true);
            this.setDirtyCanvas(true);
        };

        // --- Mouse Handling ---
        proto.convertToImageSpace = function (pos) {
            if (!this.previewArea) return null;
            const p = this.previewArea;
            if (pos[0] < p.x || pos[0] > p.x + p.width || pos[1] < p.y || pos[1] > p.y + p.height) return null;
            return [(pos[0] - p.x) / p.scale, (pos[1] - p.y) / p.scale];
        };

        proto.getHitArea = function (imgPos) {
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

        proto.onMouseDown = function (e, pos) {
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

        proto.onMouseMove = function (e, pos) {
            const [mx, my] = pos;
            const iconArea = [this.size[0] - 25, -LiteGraph.NODE_TITLE_HEIGHT, 25, LiteGraph.NODE_TITLE_HEIGHT];
            const wasHoveringHelp = this.isHoveringHelp;
            this.isHoveringHelp = (mx >= iconArea[0] && mx <= iconArea[0] + iconArea[2] && my >= iconArea[1] && my <= iconArea[1] + iconArea[3]);
            if (wasHoveringHelp !== this.isHoveringHelp) this.setDirtyCanvas(true);

            if (this.isHoveringHelp) return true;

            const imgPos = this.convertToImageSpace(pos);
            if (!this.dragging) {
                const hit = imgPos ? this.getHitArea(imgPos) : null;
                const cursors = { move: "move", tl: "nwse-resize", br: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize", t: "ns-resize", b: "ns-resize", l: "ew-resize", r: "ew-resize" };
                app.canvas.canvas.style.cursor = hit ? cursors[hit] : "default";
                return !!hit;
            }
            if (e.buttons === 0) { this.onMouseUp(e); return false; }
            if (!imgPos) return;

            this._handleDrag(imgPos);
            return true;
        };

        proto._handleDrag = function (imgPos) {
            const dx = imgPos[0] - this.dragStartImg[0], dy = imgPos[1] - this.dragStartImg[1];
            let [nx1, ny1] = [...this.origStart], [nx2, ny2] = [...this.origEnd];
            const imgW = this.properties.actualImageWidth, imgH = this.properties.actualImageHeight;
            const lock = this.widgets.find(wi => wi.name === "ratio_lock")?.value;
            const rat = lock ? parseRatio(this.widgets.find(wi => wi.name === "aspect_ratio")?.value || "1:1") : 1;

            if (this.dragMode === "move") {
                const w = nx2 - nx1, h = ny2 - ny1;
                nx1 = Math.max(0, Math.min(imgW - w, nx1 + dx)); ny1 = Math.max(0, Math.min(imgH - h, ny1 + dy));
                nx2 = nx1 + w; ny2 = ny1 + h;
            } else {
                if (this.dragMode.includes("l")) nx1 += dx; if (this.dragMode.includes("r")) nx2 += dx;
                if (this.dragMode.includes("t")) ny1 += dy; if (this.dragMode.includes("b")) ny2 += dy;

                if (lock) {
                    const ow = this.origEnd[0] - this.origStart[0], oh = this.origEnd[1] - this.origStart[1];
                    if (this.dragMode === "l" || this.dragMode === "r") {
                        if (this.dragMode === "l") { nx1 = Math.max(0, Math.min(imgW - ow, nx1)); nx2 = nx1 + ow; }
                        else { nx2 = Math.max(ow, Math.min(imgW, nx2)); nx1 = nx2 - ow; }
                        ny1 = this.origStart[1]; ny2 = this.origEnd[1];
                    } else if (this.dragMode === "t" || this.dragMode === "b") {
                        if (this.dragMode === "t") { ny1 = Math.max(0, Math.min(imgH - oh, ny1)); ny2 = ny1 + oh; }
                        else { ny2 = Math.max(oh, Math.min(imgH, ny2)); ny1 = ny2 - oh; }
                        nx1 = this.origStart[0]; nx2 = this.origEnd[0];
                    } else {
                        let nw = nx2 - nx1, nh = ny2 - ny1;
                        if (Math.abs(dx) * rat > Math.abs(dy)) { nh = nw / rat; if (this.dragMode.includes("t")) ny1 = ny2 - nh; else ny2 = ny1 + nh; }
                        else { nw = nh * rat; if (this.dragMode.includes("l")) nx1 = nx2 - nw; else nx2 = nx1 + nw; }
                        // Clamp with ratio preservation
                        if (nx1 < 0) { const d = -nx1; nx1 = 0; if (this.dragMode.includes("t")) ny1 += d / rat; else ny2 -= d / rat; }
                        if (ny1 < 0) { const d = -ny1; ny1 = 0; if (this.dragMode.includes("l")) nx1 += d * rat; else nx2 -= d * rat; }
                        if (nx2 > imgW) { const d = nx2 - imgW; nx2 = imgW; if (this.dragMode.includes("t")) ny1 += d / rat; else ny2 -= d / rat; }
                        if (ny2 > imgH) { const d = ny2 - imgH; ny2 = imgH; if (this.dragMode.includes("l")) nx1 += d * rat; else nx2 -= d * rat; }
                    }
                }
            }
            this.properties.dragStart = [Math.round(Math.max(0, Math.min(imgW - 1, nx1))), Math.round(Math.max(0, Math.min(imgH - 1, ny1)))];
            this.properties.dragEnd = [Math.round(Math.max(this.properties.dragStart[0] + 1, Math.min(imgW, nx2))), Math.round(Math.max(this.properties.dragStart[1] + 1, Math.min(imgH, ny2)))];
            this.syncWidgetsFromProperties(true); this.setDirtyCanvas(true);
        };

        proto.onMouseUp = function (e) {
            if (this.dragging) { this.dragging = false; this.dragMode = null; app.canvas.canvas.style.cursor = "default"; this.setDirtyCanvas(true); return true; }
            return false;
        };

        // --- Rendering ---
        proto.onDrawForeground = function (ctx) {
            const iconX = this.size[0] - 22, iconY = -LiteGraph.NODE_TITLE_HEIGHT + 5, iconR = 8;
            ctx.save();
            ctx.fillStyle = this.isHoveringHelp ? "#fff" : "#ff0";
            ctx.font = "bold 15px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText("?", iconX + iconR, iconY + iconR);

            if (this.isHoveringHelp) this._drawHelpSidebar(ctx);
            ctx.restore();
        };

        proto._drawHelpSidebar = function (ctx) {
            const margin = 15, bx = this.size[0] + 15, widgetH = 24;
            const labelFont = "bold 13px Arial", descFont = "normal 11px Arial";

            ctx.save();
            ctx.textBaseline = "middle";

            // 1. Calculate layout once
            let maxLabelW = 0, maxDescW = 0, minWidgetY = 10000, lastWidgetY = 0;
            ctx.font = labelFont;
            HELP_DESCRIPTIONS.forEach((item, i) => {
                maxLabelW = Math.max(maxLabelW, ctx.measureText(`${item.zh} / ${item.name}`).width);
                ctx.font = descFont;
                maxDescW = Math.max(maxDescW, ctx.measureText(`- ${item.zh_desc} / ${item.desc}`).width);
                ctx.font = labelFont;
                const w = this.widgets[i];
                if (w && w.last_y !== undefined) { minWidgetY = Math.min(minWidgetY, w.last_y); lastWidgetY = Math.max(lastWidgetY, w.last_y); }
            });

            const labelX = bx + margin + 28, descX = labelX + maxLabelW + 15;
            const boxW = (descX - bx) + maxDescW + margin;
            const by = minWidgetY - 45, boxH = (lastWidgetY + widgetH + 10) - by;

            // 2. Draw Box
            ctx.fillStyle = "rgba(0,0,0,0.95)"; ctx.strokeStyle = "#00ff44"; ctx.lineWidth = 1.6;
            if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 12); ctx.fill(); ctx.stroke(); }
            else { ctx.fillRect(bx, by, boxW, boxH); ctx.strokeRect(bx, by, boxW, boxH); }

            // 3. Draw Content
            ctx.font = "bold 16px Arial"; ctx.textAlign = "left"; ctx.fillStyle = "#00ff44";
            ctx.fillText("功能说明 / Explanations", bx + margin, by + 22);

            HELP_DESCRIPTIONS.forEach((item, i) => {
                const w = this.widgets[i]; if (!w) return;
                const y = w.last_y + (widgetH / 2);
                ctx.font = "14px Arial"; ctx.fillStyle = "#fff"; ctx.fillText(item.icon, bx + margin, y);
                ctx.font = labelFont; ctx.fillText(`${item.zh} / ${item.name}`, labelX, y);
                ctx.font = descFont; ctx.fillStyle = "#aaa"; ctx.fillText(`- ${item.zh_desc} / ${item.desc}`, descX, y);
            });
            ctx.restore();
        };

        proto._drawPreviewCanvas = function (ctx, node, width, y) {
            const margin = 10, drawW = width - margin * 2, drawH = Math.max(150, node.size[1] - y - margin * 2), startY = y + margin;
            ctx.fillStyle = "#161616"; ctx.fillRect(margin, startY, drawW, drawH);

            if (!node.imageLoaded) { ctx.fillStyle = "#666"; ctx.textAlign = "center"; ctx.fillText("No Image", margin + drawW / 2, startY + drawH / 2); return; }
            const imgAR = node.image.width / node.image.height, areaAR = drawW / drawH;
            let pw, ph, px, py;
            if (imgAR > areaAR) { pw = drawW; ph = drawW / imgAR; px = margin; py = startY + (drawH - ph) / 2; }
            else { ph = drawH; pw = drawH * imgAR; px = margin + (drawW - pw) / 2; py = startY; }
            ctx.drawImage(node.image, px, py, pw, ph);

            const scale = pw / node.properties.actualImageWidth;
            const [x1, y1] = node.properties.dragStart, [x2, y2] = node.properties.dragEnd;
            const rx = px + x1 * scale, ry = py + y1 * scale, rw = (x2 - x1) * scale, rh = (y2 - y1) * scale;

            ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.rect(rx, ry, rw, rh); ctx.fill("evenodd");
            ctx.strokeStyle = "#0f0"; ctx.lineWidth = 2; ctx.strokeRect(rx, ry, rw, rh);

            const curW = Math.round(x2 - x1), curH = Math.round(y2 - y1);
            const pW = Math.round((curW / node.properties.actualImageWidth) * 100), pH = Math.round((curH / node.properties.actualImageHeight) * 100);
            ctx.font = "bold 14px Arial"; ctx.textAlign = "center"; ctx.shadowColor = "black"; ctx.shadowBlur = 4; ctx.fillStyle = "#aaff00";
            ctx.fillText(`${pW} × ${pH} %`, px + pw / 2, py + ph / 2 + 5);
            ctx.fillText(`${curW} × ${curH} px`, px + pw / 2, py + ph / 2 + 22);
            ctx.restore();
            node.previewArea = { x: px, y: py, width: pw, height: ph, scale: scale };
        };

        proto.onWidgetChanged = function (name, val) {
            if (this._isSyncing) return;
            const find = (n) => this.widgets.find(w => w.name === n);
            if (["crop_left", "crop_right", "crop_top", "crop_bottom"].includes(name)) {
                this.syncPropertiesFromWidgets();
                if (find("ratio_lock")?.value) {
                    const [ox1, oy1] = [...this.origStart || this.properties.dragStart], [ox2, oy2] = [...this.origEnd || this.properties.dragEnd];
                    const ow = ox2 - ox1, oh = oy2 - oy1, imgW = this.properties.actualImageWidth, imgH = this.properties.actualImageHeight;
                    let fx1 = this.properties.dragStart[0], fy1 = this.properties.dragStart[1], fx2 = this.properties.dragEnd[0], fy2 = this.properties.dragEnd[1];
                    if (name === "crop_left") { fx2 = fx1 + ow; } else if (name === "crop_right") { fx1 = fx2 - ow; }
                    else if (name === "crop_top") { fy2 = fy1 + oh; } else if (name === "crop_bottom") { fy1 = fy2 - oh; }
                    this.properties.dragStart = [Math.max(0, Math.min(imgW - 1, fx1)), Math.max(0, Math.min(imgH - 1, fy1))];
                    this.properties.dragEnd = [Math.max(fx1 + 1, Math.min(imgW, fx2)), Math.max(fy1 + 1, Math.min(imgH, fy2))];
                }
                this.syncWidgetsFromProperties(true);
            } else if (name === "crop_current_width" || name === "crop_current_height") {
                const [x1, y1] = this.properties.dragStart, [x2, y2] = this.properties.dragEnd, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
                let nw = (name === "crop_current_width") ? val : Math.abs(x2 - x1), nh = (name === "crop_current_height") ? val : Math.abs(y2 - y1);
                if (find("ratio_lock")?.value) {
                    const r = parseRatio(find("aspect_ratio")?.value || "1:1");
                    if (name === "crop_current_width") nh = nw / r; else nw = nh * r;
                }
                this.properties.dragStart = [Math.max(0, cx - nw / 2), Math.max(0, cy - nh / 2)];
                this.properties.dragEnd = [this.properties.dragStart[0] + nw, this.properties.dragStart[1] + nh];
                this.syncWidgetsFromProperties(true);
            } else if (name === "aspect_ratio") {
                const p = find("Ratio Presets"); if (p && p.value !== val) p.value = p.options.values.includes(val) ? val : "Custom";
                this.applyAspectRatio(val);
            } else if (name === "ratio_lock" && val) this.applyAspectRatio();
        };

        proto.onExecuted = function (message) {
            if (message?.images && message.images.length > 0) {
                const img = message.images[0], url = api.apiURL(`/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder || "")}`);
                if (message.orig_size) {
                    const [newW, newH] = message.orig_size, oldW = this.properties.actualImageWidth, oldH = this.properties.actualImageHeight;
                    this.properties.actualImageWidth = newW; this.properties.actualImageHeight = newH;
                    if (newW !== oldW || newH !== oldH) this.applyAspectRatio("Full");
                }
                if (message.preview_scale) this.previewScale = Array.isArray(message.preview_scale) ? message.preview_scale[0] : message.preview_scale;
                this.image.src = url; this.imageLoaded = false; this.setDirtyCanvas(true);
            }
        };

        proto.onDrawBackground = function () { if (this.dragging) return; };
    },
    nodeCreated(node) {
        if (node.comfyClass === "FreeDragCrop") {
            const lock = node.widgets.find(w => w.name === "ratio_lock");
            if (lock) lock.value = true;
        }
    }
});
