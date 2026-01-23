# Free Drag Crop Node for ComfyUI

An interactive, user-friendly cropping node that allows you to drag and resize the crop area directly in the ComfyUI interface.

## Features

- **🚀 Immediate Preview**: See your image as soon as you connect a `Load Image` node. No need to run the graph first.
- **🎯 Smart Centering**: 
    - **Center Image**: Snaps the crop box to the center of the canvas.
    - **Center Subject**: Uses a heuristic to find the main subject (non-background area) and centers the crop box on it.
- **🔒 Aspect Ratio Lock**: Keep your desired proportions while resizing.
- **Outputs**: 
    - `IMAGE`: The cropped image.
    - `MASK`: A mask matching the cropped area.
    - `CROP_JSON`: Metadata about the crop (x, y, w, h).

## Installation

1. Copy this folder (`free-drag-crop`) into your ComfyUI `custom_nodes` directory.
2. Restart ComfyUI.

## Usage

1. Add the **Free Drag Crop** node.
2. Connect an image to the `image` input.
3. Drag the green box in the preview to select your crop area.
4. (Optional) Toggle **Ratio Lock** if you want to maintain a specific aspect ratio.
5. (Optional) Use **Center Subject** to quickly find the focus of your image.

---
Created by Antigravity
