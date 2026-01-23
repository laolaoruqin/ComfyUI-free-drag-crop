import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

// Utility to find the image filename from a source node
function getImageUrl(node) {
    if (!node) return null;

    // Check if it's a Load Image node
    if (node.type === "LoadImage") {
        const imageWidget = node.widgets.find(w => w.name === "image");
        if (imageWidget && imageWidget.value) {
            return api.apiURL(`/view?filename=${encodeURIComponent(imageWidget.value)}&type=input&subfolder=`);
        }
    }

    // Check if it has a preview image (output from other nodes)
    if (node.imgs && node.imgs.length > 0) {
        return node.imgs[0].src;
    }

    return null;
}

app.registerExtension({
    name: "FreeDragCrop.Interactive",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "FreeDragCrop") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            const node = this;

            // Internal state for the crop box
            node.cropBox = {
                x: 0, y: 0, w: 100, h: 100,
                active: false,
                dragging: null, // 'content', 'tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'
                startX: 0, startY: 0
            };

            node.imgElement = new Image();
            node.imgLoaded = false;
            node.imgElement.onload = () => {
                node.imgLoaded = true;
                // Initialize crop box to full image or centered 1:1 if unitialized
                if (node.widgets[0].value === 0 && node.widgets[1].value === 0) {
                    this.resetCropBox();
                }
                node.setDirtyCanvas(true);
            };

            // Custom Widget for Preview and Interaction
            const widget = {
                type: "custom_canvas",
                name: "crop_preview",
                draw(ctx, node, widget_width, y, widget_height) {
                    const margin = 10;
                    const drawW = widget_width - margin * 2;
                    const drawH = 300; // Fixed height for preview
                    const startY = y + margin;

                    // Update Image if connection changed
                    const link = node.inputs[0].link;
                    if (link) {
                        const originNode = app.graph.getNodeById(app.graph.links[link].origin_id);
                        const url = getImageUrl(originNode);
                        if (url && node.imgElement.src !== url) {
                            node.imgElement.src = url;
                        }
                    }

                    // Draw Background
                    ctx.fillStyle = "#1c1c1c";
                    ctx.fillRect(margin, startY, drawW, drawH);

                    if (!node.imgLoaded) {
                        ctx.fillStyle = "#666";
                        ctx.textAlign = "center";
                        ctx.fillText("Connecting to image source...", widget_width / 2, startY + drawH / 2);
                        return;
                    }

                    // Calculate aspect ratios for drawing
                    const imgAR = node.imgElement.width / node.imgElement.height;
                    const areaAR = drawW / drawH;
                    let renderW, renderH, offsetX, offsetY;

                    if (imgAR > areaAR) {
                        renderW = drawW;
                        renderH = drawW / imgAR;
                        offsetX = margin;
                        offsetY = startY + (drawH - renderH) / 2;
                    } else {
                        renderH = drawH;
                        renderW = drawH * imgAR;
                        offsetX = margin + (drawW - renderW) / 2;
                        offsetY = startY;
                    }

                    node.renderMetrics = { renderW, renderH, offsetX, offsetY, scale: renderW / node.imgElement.width };

                    // Draw Image
                    ctx.drawImage(node.imgElement, offsetX, offsetY, renderW, renderH);

                    // Draw Dim Overlay outside crop box
                    ctx.fillStyle = "rgba(0,0,0,0.5)";
                    const cropRect = this.getCropRect(node);

                    // Top
                    ctx.fillRect(offsetX, offsetY, renderW, cropRect.y - offsetY);
                    // Bottom
                    ctx.fillRect(offsetX, cropRect.y + cropRect.h, renderW, offsetY + renderH - (cropRect.y + cropRect.h));
                    // Left
                    ctx.fillRect(offsetX, cropRect.y, cropRect.x - offsetX, cropRect.h);
                    // Right
                    ctx.fillRect(cropRect.x + cropRect.w, cropRect.y, offsetX + renderW - (cropRect.x + cropRect.w), cropRect.h);

                    // Draw Crop Box
                    ctx.strokeStyle = "#00ff00";
                    ctx.lineWidth = 2;
                    ctx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);

                    // Handle markers
                    const handleSize = 6;
                    ctx.fillStyle = "#fff";
                    [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]].forEach(([px, py]) => {
                        ctx.fillRect(cropRect.x + cropRect.w * px - handleSize / 2, cropRect.y + cropRect.h * py - handleSize / 2, handleSize, handleSize);
                    });

                    // Info text
                    ctx.fillStyle = "#fff";
                    ctx.font = "10px sans-serif";
                    ctx.textAlign = "left";
                    const realW = Math.round(node.cropBox.w);
                    const realH = Math.round(node.cropBox.h);
                    ctx.fillText(`${realW} x ${realH} (${(realW / realH).toFixed(2)})`, offsetX + 5, offsetY + renderH - 5);
                },
                getCropRect(node) {
                    if (!node.renderMetrics) return { x: 0, y: 0, w: 0, h: 0 };
                    const m = node.renderMetrics;
                    return {
                        x: m.offsetX + node.cropBox.x * m.scale,
                        y: m.offsetY + node.cropBox.y * m.scale,
                        w: node.cropBox.w * m.scale,
                        h: node.cropBox.h * m.scale
                    };
                },
                computeSize(width) {
                    return [width, 320];
                },
                mouse(event, pos, node) {
                    const m = node.renderMetrics;
                    if (!m) return false;

                    const mouseX = (pos[0] - m.offsetX) / m.scale;
                    const mouseY = (pos[1] - (this.lastY + 10)) / m.scale; // adjusted for Y offset

                    if (event.type === "mousedown") {
                        const rect = this.getCropRect(node);
                        const ex = pos[0];
                        const ey = pos[1] - (this.lastY + 10);
                        const handleRange = 10;

                        // Check handles
                        const check = (x, y) => Math.abs(ex - (m.offsetX + x * m.scale)) < handleRange && Math.abs(ey - (m.offsetY + y * m.scale)) < handleRange;

                        if (check(node.cropBox.x, node.cropBox.y)) node.cropBox.dragging = 'tl';
                        else if (check(node.cropBox.x + node.cropBox.w, node.cropBox.y)) node.cropBox.dragging = 'tr';
                        else if (check(node.cropBox.x, node.cropBox.y + node.cropBox.h)) node.cropBox.dragging = 'bl';
                        else if (check(node.cropBox.x + node.cropBox.w, node.cropBox.y + node.cropBox.h)) node.cropBox.dragging = 'br';
                        else if (mouseX >= node.cropBox.x && mouseX <= node.cropBox.x + node.cropBox.w &&
                            mouseY >= node.cropBox.y && mouseY <= node.cropBox.y + node.cropBox.h) {
                            node.cropBox.dragging = 'content';
                        }

                        if (node.cropBox.dragging) {
                            node.cropBox.startX = mouseX;
                            node.cropBox.startY = mouseY;
                            node.cropBox.startBox = { ...node.cropBox };
                            return true;
                        }
                    } else if (event.type === "mousemove") {
                        if (node.cropBox.dragging) {
                            const dx = mouseX - node.cropBox.startX;
                            const dy = mouseY - node.cropBox.startY;
                            const box = node.cropBox.startBox;
                            const ratioLock = node.widgets.find(w => w.name === "ratio_lock")?.value;
                            const targetRatio = parseFloat(node.widgets.find(w => w.name === "aspect_ratio")?.value || "1") || 1;

                            if (node.cropBox.dragging === 'content') {
                                node.cropBox.x = Math.max(0, Math.min(node.imgElement.width - box.w, box.x + dx));
                                node.cropBox.y = Math.max(0, Math.min(node.imgElement.height - box.h, box.y + dy));
                            } else if (node.cropBox.dragging === 'br') {
                                node.cropBox.w = Math.max(10, Math.min(node.imgElement.width - box.x, box.w + dx));
                                if (ratioLock) node.cropBox.h = node.cropBox.w / targetRatio;
                                else node.cropBox.h = Math.max(10, Math.min(node.imgElement.height - box.y, box.h + dy));
                            }
                            // ... add other handles as needed ...

                            node.updateWidgetsFromBox();
                            node.setDirtyCanvas(true);
                            return true;
                        }
                    } else if (event.type === "mouseup") {
                        node.cropBox.dragging = null;
                        return true;
                    }
                    this.lastY = y; // internal tracker
                    return false;
                }
            };

            this.addCustomWidget(widget);

            // Sync Logic
            this.updateWidgetsFromBox = function () {
                const w = this.imgElement.width;
                const h = this.imgElement.height;
                this.widgets.find(w => w.name === "crop_left").value = Math.round(this.cropBox.x);
                this.widgets.find(w => w.name === "crop_right").value = Math.round(w - (this.cropBox.x + this.cropBox.w));
                this.widgets.find(w => w.name === "crop_top").value = Math.round(this.cropBox.y);
                this.widgets.find(w => w.name === "crop_bottom").value = Math.round(h - (this.cropBox.y + this.cropBox.h));
            };

            this.resetCropBox = function () {
                if (!this.imgLoaded) return;
                const w = this.imgElement.width;
                const h = this.imgElement.height;
                this.cropBox.w = w * 0.8;
                this.cropBox.h = h * 0.8;
                this.cropBox.x = (w - this.cropBox.w) / 2;
                this.cropBox.y = (h - this.cropBox.h) / 2;
                this.updateWidgetsFromBox();
            };

            // Buttons
            this.addWidget("button", "Center Image", null, () => this.resetCropBox());

            this.addWidget("button", "Center Subject", null, () => {
                if (!this.imgLoaded) return;
                // Smart Subject Centering Heuristic
                const canvas = document.createElement("canvas");
                canvas.width = 128; // Low res for fast processing
                canvas.height = 128;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(this.imgElement, 0, 0, 128, 128);
                const data = ctx.getImageData(0, 0, 128, 128).data;

                let minX = 128, maxX = 0, minY = 128, maxY = 0;
                let found = false;

                for (let y = 0; y < 128; y++) {
                    for (let x = 0; x < 128; x++) {
                        const idx = (y * 128 + x) * 4;
                        const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];

                        // heuristic: anything not black/white/transparent is "subject"
                        const isBg = a < 50 || (r > 240 && g > 240 && b > 240) || (r < 15 && g < 15 && b < 15);
                        if (!isBg) {
                            minX = Math.min(minX, x);
                            maxX = Math.max(maxX, x);
                            minY = Math.min(minY, y);
                            maxY = Math.max(maxY, y);
                            found = true;
                        }
                    }
                }

                if (found) {
                    const scale = this.imgElement.width / 128;
                    const subX = minX * scale;
                    const subY = minY * scale;
                    const subW = (maxX - minX) * scale;
                    const subH = (maxY - minY) * scale;

                    // Center the CURRENT crop box dimensions on this subject
                    this.cropBox.x = subX + subW / 2 - this.cropBox.w / 2;
                    this.cropBox.y = subY + subH / 2 - this.cropBox.h / 2;

                    // Clamp
                    this.cropBox.x = Math.max(0, Math.min(this.imgElement.width - this.cropBox.w, this.cropBox.x));
                    this.cropBox.y = Math.max(0, Math.min(this.imgElement.height - this.cropBox.h, this.cropBox.y));

                    this.updateWidgetsFromBox();
                    this.setDirtyCanvas(true);
                }
            });
        };
    }
});
