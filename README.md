# Spoke Studio

Spoke Studio is a shared workspace for creating and editing binary masks. It is heavily vibe-coded as its main purpose is to only serve as a tool, and not a final research product. Open the app in a modern browser:

**https://spoke-studio.keshavgulati785.workers.dev**

No installation is needed, and your work is saved online.

## Get started

1. Select **Sign up**.
2. Enter your email address and choose the username you want collaborators to see.
3. Select **Create account**.

Your username and unique user ID identify your image uploads and mask edits. To use an existing account, choose **Log in** and enter its email address. Your login normally lasts for 30 days, including across app updates.

**Use your real email address.** Accounts have no passwords and emails are not verified. Spoke Studio is intended for trusted collaborators, not for protecting sensitive information.

## Work with projects

The project dashboard shows every shared project, including its image and saved-mask counts.

- **Create:** Choose **Create**, give the project a descriptive name, and select **Create project**.
- **Open a project:** Select its project card. Your current mask is saved before you switch projects or return to the dashboard.
- **Find a project:** Use the search field on the dashboard.
- **Rename or delete:** Open the project's **⋯** menu.

Everyone who signs in can view and contribute to all projects.

## Add images and masks

Use the buttons at the top of an open project:

- **Import folder:** Choose a folder containing PNG images, including PNGs in its subfolders.
- **Import images:** Select one or more PNG files.
- **Import masks:** Import previously created PNG masks for the current image sequence.

Images are sorted by filename. Duplicate filenames are not supported. New images must be imported into an empty project; create another project when starting a different sequence.

An imported mask should have the same filename as its source image, for example `image.png` or `image_mask.png`, and exactly the same dimensions. For a single differently named mask, you can confirm applying it to the current frame.

Black or transparent pixels become background; visible nonzero pixels become foreground.

## Create and edit masks

The image viewer provides several annotation tools:

- **Brush:** Paint foreground.
- **Eraser:** Remove foreground.
- **Polygon:** Click each vertex, then press **Enter** to fill the shape. Press **Esc** to cancel.
- **Pan:** Drag the image to move around it.
- **Pixel inspection:** Inspect displayed image and mask values at a point.

Use your mouse wheel to zoom, middle- or right-drag to pan, and **Fit** to fit the image in the viewer. Brush size can be adjusted with either size slider.

Masks save automatically after brush strokes, polygon fills, undo/redo, and before navigation. **Save** writes any pending changes immediately. A saved mask may be entirely black; being marked as saved does not mean it has been scientifically reviewed.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| Left / Right arrow | Previous / next frame |
| Space | Start / stop playback |
| B / E / P | Brush / eraser / polygon |
| H / V | Pan / pixel inspection |
| F | Fit image |
| Plus / Minus | Zoom in / out |
| [ / ] | Decrease / increase brush diameter |
| M | Show / hide mask overlay |
| Ctrl/Cmd+Z | Undo |
| Shift+Ctrl/Cmd+Z | Redo |
| S | Save mask |
| Enter | Fill polygon |
| Esc | Cancel polygon |

## Collaborate on masks

Each image has **one shared project mask**. When someone saves, their version replaces the previous project version, and their username becomes its latest editor. Avoid editing the same mask at the same time as someone else; separate manual review is recommended if you need independent results.

The viewer shows who uploaded the current image and who most recently edited its mask. Existing older media may not have contributor information.

## Display and navigation

Brightness, contrast, gamma, and black/white levels change only the display. They do not alter the uploaded image or mask. Settings and viewing position are carried between frames where possible.

The previous/next-frame overlay can help compare adjacent images. It uses raw pixel coordinates; images are not automatically aligned.

Images are optimized for faster loading, which may slightly change displayed pixel values. Original uploaded images remain unchanged. Mask exports are not affected by these display optimizations.

Use **Download mask** to save the current binary mask. Downloaded masks use 0 for background and 255 for foreground.

## Deleted projects

Deleted projects disappear from the dashboard, and their online contents move to **Recently Deleted** for 30 days before permanent removal. Contact the person who manages the workspace promptly if you need a deleted project restored.

## Deployment and maintenance

See [DEPLOYMENT.md](DEPLOYMENT.md) for technical setup, migration, configuration, and testing instructions.
