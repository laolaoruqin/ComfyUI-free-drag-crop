import torch
import numpy as np
from PIL import Image
import folder_paths
import os
import json
import random
import string

class FreeDragCrop:
    """
    A professional ComfyUI node for interactive high-precision cropping.
    Provides a canvas-based interface for visual selection.
    """
    
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE",),
                "crop_left": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 1}),
                "crop_right": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 1}),
                "crop_top": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 1}),
                "crop_bottom": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 1}),
            },
            "optional": {
                "crop_current_width": ("INT", {"default": 512, "min": 0, "max": 16384, "step": 1}),
                "crop_current_height": ("INT", {"default": 512, "min": 0, "max": 16384, "step": 1}),
                "aspect_ratio": ("STRING", {"default": "16:9"}),
                "ratio_lock": ("BOOLEAN", {"default": True}),
                "mask": ("MASK",),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "CROP_JSON")
    FUNCTION = "execute_crop"
    CATEGORY = "image/process"
    OUTPUT_NODE = True

    def execute_crop(self, image: torch.Tensor, crop_left: int, crop_right: int, crop_top: int, crop_bottom: int, 
                     crop_current_width: int = 512, crop_current_height: int = 512, 
                     aspect_ratio: str = "1:1", ratio_lock: bool = False, mask: torch.Tensor = None):
        """
        Performs the actual cropping operation on the input tensor based on UI coordinates.
        """
        # image shape: [Batch, Height, Width, Channels]
        batch_size, h, w, channels = image.shape
        
        # 1. Calculate and validate crop boundaries
        left = max(0, min(w - 1, crop_left))
        right = max(left + 1, min(w, w - crop_right))
        top = max(0, min(h - 1, crop_top))
        bottom = max(top + 1, min(h, h - crop_bottom))
        
        # 2. Slice image tensor
        cropped_image = image[:, top:bottom, left:right, :]
        
        # 3. Handle Mask
        if mask is not None:
            # mask shape: [Batch, Height, Width]
            cropped_mask = mask[:, top:bottom, left:right]
        else:
            # Default to full white mask if none provided
            cropped_mask = torch.ones((batch_size, bottom - top, right - left), dtype=torch.float32)

        # 4. Prepare metadata for downstream nodes
        crop_metadata = {
            "x": int(left),
            "y": int(top),
            "width": int(right - left),
            "height": int(bottom - top),
            "orig_width": int(w),
            "orig_height": int(h)
        }
        
        # 5. Generate Preview Image (High-precision reduction to 1024px)
        preview_results = []
        preview_tensor = image[0] # Take first from batch for UI
        preview_array = 255. * preview_tensor.cpu().numpy()
        preview_img = Image.fromarray(np.clip(preview_array, 0, 255).astype(np.uint8))
        
        MAX_PREVIEW_SIZE = 1024
        preview_scale = 1.0
        if preview_img.width > MAX_PREVIEW_SIZE or preview_img.height > MAX_PREVIEW_SIZE:
            preview_scale = MAX_PREVIEW_SIZE / max(preview_img.width, preview_img.height)
            new_size = (int(preview_img.width * preview_scale), int(preview_img.height * preview_scale))
            preview_img = preview_img.resize(new_size, Image.Resampling.BILINEAR)
        
        # 6. Save temp preview for JS frontend
        full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
            "free_drag_crop_preview", folder_paths.get_temp_directory()
        )
        
        random_suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=5))
        preview_filename = f"{filename}_{counter:05}_{random_suffix}.png"
        preview_path = os.path.join(full_output_folder, preview_filename)
        
        preview_img.save(preview_path)
        preview_results.append({
            "filename": preview_filename,
            "subfolder": subfolder,
            "type": "temp"
        })

        return {
            "ui": {
                "images": preview_results,
                "preview_scale": [preview_scale],
                "orig_size": [int(w), int(h)]
            },
            "result": (cropped_image, cropped_mask, json.dumps(crop_metadata))
        }

NODE_CLASS_MAPPINGS = {
    "FreeDragCrop": FreeDragCrop
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FreeDragCrop": "Free Drag Crop (Interactive)"
}
