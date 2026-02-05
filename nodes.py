import torch
import numpy as np
from PIL import Image
import folder_paths
import os
import json
import random
import string

class FreeDragCrop:
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
    FUNCTION = "crop"
    CATEGORY = "image/process"
    OUTPUT_NODE = True

    def crop(self, image, crop_left, crop_right, crop_top, crop_bottom, crop_current_width=512, crop_current_height=512, aspect_ratio="1:1", ratio_lock=False, mask=None):
        # image shape: [B, H, W, C]
        _, h, w, _ = image.shape
        
        # Ensure crops are within bounds and logical
        left = max(0, min(w - 1, crop_left))
        right = max(left + 1, min(w, w - crop_right))
        top = max(0, min(h - 1, crop_top))
        bottom = max(top + 1, min(h, h - crop_bottom))
        
        # Slice image
        cropped_image = image[:, top:bottom, left:right, :]
        
        # Slice mask if exists
        cropped_mask = None
        if mask is not None:
            # mask shape: [B, H, W]
            cropped_mask = mask[:, top:bottom, left:right]
        else:
            # Create a full white mask of the cropped size
            cropped_mask = torch.ones((image.shape[0], bottom - top, right - left), dtype=torch.float32)

        crop_json = {
            "x": int(left),
            "y": int(top),
            "width": int(right - left),
            "height": int(bottom - top),
            "orig_width": int(w),
            "orig_height": int(h)
        }
        
        # Save input image for preview (the one before cropping)
        preview_results = list()
        # Take first image in batch for preview
        preview_tensor = image[0]
        preview_array = 255. * preview_tensor.cpu().numpy()
        preview_img = Image.fromarray(np.clip(preview_array, 0, 255).astype(np.uint8))
        
        # Memory optimization: downsample preview but track the scale
        MAX_PREVIEW_SIZE = 1024
        preview_scale = 1.0
        if preview_img.width > MAX_PREVIEW_SIZE or preview_img.height > MAX_PREVIEW_SIZE:
            preview_scale = MAX_PREVIEW_SIZE / max(preview_img.width, preview_img.height)
            new_size = (int(preview_img.width * preview_scale), int(preview_img.height * preview_scale))
            preview_img = preview_img.resize(new_size, Image.Resampling.BILINEAR)
        
        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path("free_drag_crop_preview", folder_paths.get_temp_directory())
        
        rand = ''.join(random.choices(string.ascii_lowercase + string.digits, k=5))
        preview_file = f"{filename}_{counter:05}_{rand}.png"
        
        preview_img.save(os.path.join(full_output_folder, preview_file))
        preview_results.append({
            "filename": preview_file,
            "subfolder": subfolder,
            "type": "temp"
        })

        return {
            "ui": {
                "images": preview_results,
                "preview_scale": [preview_scale],
                "orig_size": [int(w), int(h)]
            },
            "result": (cropped_image, cropped_mask, json.dumps(crop_json))
        }

NODE_CLASS_MAPPINGS = {
    "FreeDragCrop": FreeDragCrop
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FreeDragCrop": "Free Drag Crop (Interactive)"
}
