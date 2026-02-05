# ComfyUI-free-drag-crop

[English](#english-version) | [中文](#中文说明) | [Technical Highlights / 技术亮点](#technical-highlights--技术亮点)

---

# English Version

A professional, high-precision interactive cropping node for ComfyUI. Drag, resize, and lock aspect ratios directly on the node's canvas.

![Node Preview](https://github.com/laolaoruqin/ComfyUI-free-drag-crop/raw/main/preview.png)

## Key Features 🚀

- **Interactive Canvas**: Drag to select, resize from 8-point handles, or move the entire selection area.
- **Real-Pixel Precision**: All calculations are based on original image dimensions to prevent rounding errors or resolution drifts.
- **Aspect Ratio Locking**: Lock your selection to a specific ratio (e.g., 16:9, 1:1) and adjust boundaries while maintaining the frame.
- **Smart Presets**: Quick access to common ratios (4:3, 9:16, 21:9, etc.).
- **Smart Resets**:
  - **Full Image Crop**: Expand to the maximum possible coverage for the current ratio.
  - **No Crop**: Reset to origin with 1x1 pixel selection (ideal for bypassing crop logic).
- **Responsive Sync**: Real-time synchronization between the visual canvas and numeric widgets.

## Installation 🛠️

1. Navigate to your ComfyUI custom nodes folder:
   ```bash
   cd ComfyUI/custom_nodes/
   ```
2. Clone this repository:
   ```bash
   git clone https://github.com/laolaoruqin/ComfyUI-free-drag-crop.git
   ```
3. Restart ComfyUI.

---

# 中文说明

为 ComfyUI 量身定做的专业级、高精度交互式裁剪节点。直接在画板上拖拽、缩放，并支持严格的比例锁定。

## 核心特性 🌟

- **交互式画板**：支持 8 点缩放、整体移动和拖拽选择。
- **真实像素精度**：所有计算均基于原图尺寸，彻底杜绝舍入误差造成的选区偏移。
- **比例锁定**：支持一键开启比例锁定（如 16:9），并在缩放边界时自动维持该比例。
- **比例预设**：内置常用比例（1:1, 4:3, 3:2, 21:9 等）快速切换。
- **智能重置**：
  - **Full Image Crop (全图自适应)**：在当前比例下自动扩展至最大选区。
  - **No Crop (清空裁剪)**：一键归零，恢复至初始状态。
- **极速响应**：画板手感顺滑，数值输入与画面实时同步。

## 安装说明 📦

1. 进入 ComfyUI 的自定义节点目录：
   ```bash
   cd ComfyUI/custom_nodes/
   ```
2. 克隆本仓库：
   ```bash
   git clone https://github.com/laolaoruqin/ComfyUI-free-drag-crop.git
   ```
3. 重启 ComfyUI 即可使用。

---

# Technical Highlights / 技术亮点

> [!TIP]
> [EN] This node uses a high-performance rendering loop and a specialized "Resolution Stability Guard". Unlike other crop nodes that drift on large images, **Free Drag Crop** maintains sub-pixel accuracy even for 8K+ resolutions.
>
> [CN] 该节点采用了高性能渲染循环和专门的“分辨率稳定性卫士”。与处理大图时容易产生偏移的其他裁剪节点不同，**Free Drag Crop** 即使在 8K+ 分辨率下也能保持亚像素级的精确度。
