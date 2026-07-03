import os
from PIL import Image

def generate_assets(source_image_path, target_dir):
    """Resizes the source logo image into the various sizes required by MSIX."""
    if not os.path.exists(source_image_path):
        print(f"Error: Source image not found at {source_image_path}")
        return False
        
    if not os.path.exists(target_dir):
        os.makedirs(target_dir)
        print(f"Created target directory: {target_dir}")
        
    try:
        # Load source image
        with Image.open(source_image_path) as img:
            # We want to crop to square if not square, but generated image is 1:1 already
            
            # Target sizes
            sizes = {
                "StoreLogo.png": (50, 50),
                "Square150x150Logo.png": (150, 150),
                "Square44x44Logo.png": (44, 44),
                "Wide310x150Logo.png": (310, 150), # We can center and pad this one
            }
            
            for filename, size in sizes.items():
                dest_path = os.path.join(target_dir, filename)
                
                if size[0] == size[1]:
                    # Simple square resize
                    resized_img = img.resize(size, Image.Resampling.LANCZOS)
                    resized_img.save(dest_path, "PNG")
                    print(f"Generated: {dest_path} ({size[0]}x{size[1]})")
                else:
                    # Non-square (Wide310x150Logo)
                    # We crop/fit the square image into a 310x150 format by keeping central region or adding borders
                    # Let's create a black/dark canvas and paste the square image inside, centered
                    canvas = Image.new("RGBA", size, (7, 9, 19, 255)) # matching --bg-base
                    
                    # Scale square image to fit height (150)
                    sq_size = (size[1], size[1])
                    temp_img = img.resize(sq_size, Image.Resampling.LANCZOS)
                    
                    # Center offset
                    x_offset = (size[0] - size[1]) // 2
                    canvas.paste(temp_img, (x_offset, 0))
                    canvas.save(dest_path, "PNG")
                    print(f"Generated: {dest_path} ({size[0]}x{size[1]})")
                    
        return True
    except Exception as e:
        print(f"Failed to generate assets: {e}")
        return False

if __name__ == "__main__":
    # Source image generated from Gemini
    source = r"C:\Users\Winter\.gemini\antigravity\brain\03da9b33-26ea-4b8f-98f0-c1b052ddeb44\starlink_logo_1783105244581.jpg"
    
    # Fallback to local workspace search if path is different
    if not os.path.exists(source):
        source = "starlink_logo.jpg"
        
    target = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Assets")
    generate_assets(source, target)
