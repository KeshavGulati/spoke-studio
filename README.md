# Spoke Studio

Live at: **https://spoke-studio.keshavgulati785.workers.dev**

## Introduction

Spoke Studio is a tool I created for better marking up of images into binary masks for my project at the University of Maryland, College Park. The tool is highly vibe-coded using Kimi K3.1, because its main purpose is to only serve as a tool and not a final research product. The model I used was Kimi K3.1, and most of the README (except this part) was also written using this agent.

The motivation for this tool comes from the limitations and bottlenecks of [Label Studio](https://labelstud.io/), and from the features and bottlenecks of [DS9](https://sites.google.com/cfa.harvard.edu/saoimageds9?pli=1&authuser=0). Label Studio is very useful for labelling data, including binary segmentation masks which are the main labels for this project. However, it lacks in its capability for image viewing, and there are not many transformations that are available to make labelling easier. On the other hand, DS9 offers a wide set of such transformations which make viewing spokes much easier, and hence makes it easier to mark them and create a better dataset. However, the labelling capability of DS9 is limited as it is mainly a viewing tool, and so the only way mark up images is as strict polygons.

This tool aims to provide the power of label studio for marking images, and the power of DS9 for viewing images, and is geared to be easy to setup.

The rest of this README is written by Kimi.

## Table of contents

- [Get started](#get-started)
- [Work with projects](#work-with-projects)
- [Add images and masks](#add-images-and-masks)
- [Create and edit masks](#create-and-edit-masks)
  - [Keyboard shortcuts](#keyboard-shortcuts)
- [Collaborate on masks](#collaborate-on-masks)
- [Image Display](#image-display)
  - [Brightness and contrast](#brightness-and-contrast)
  - [Scale](#scale)
  - [Automatic levels](#automatic-levels)
  - [Resetting the display](#resetting-the-display)
- [Deleted projects](#deleted-projects)
- [Deployment and maintenance](#deployment-and-maintenance)

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

## Image Display

These controls change only what you see. They do **not** alter uploaded images, saved masks, or mask exports. Settings and viewing position are carried between frames where possible, so comparisons between frames use the same choices until you change them.

### Brightness and contrast

| Control | What it does |
| --- | --- |
| **Brightness** | Adds or removes brightness across the image. Increase it to make the scene brighter or decrease it to make it darker. Very bright or dark values are clipped to the displayable range. |
| **Contrast** | Adjusts separation between darker and brighter pixels around the middle of the intensity range. Values above 1 increase contrast; values below 1 reduce it and move the image closer to gray. The default is 1. |
| **Gamma** | Changes the balance between shadows and highlights more subtly than black/white clipping. Decrease gamma to darken midtones or increase it to brighten them. Black and white endpoints remain fixed. The default is 1. |
| **Black level** | Sets the intensity displayed as black. Pixels at or below this value appear black; values above it are spread over the remaining display range. Raising black level can hide background noise, but it also removes faint detail below the threshold. |
| **White level** | Sets the intensity displayed as white. Pixels at or above this value appear white. Lowering white level brightens faint features, while increasing it can preserve detail in bright features. Values beyond the selected level are clipped to white. |

Black and white levels are the lower and upper limits for all scale modes. Together with brightness, contrast, and gamma, they let you tune the display without changing the scientific source data.

### Scale

The **Scale** menu controls how intensities between the black and white levels are distributed on screen. It does not change the actual ranges or erase mask pixels.

| Mode | When to use it |
| --- | --- |
| **Linear** | Maps intensity evenly from black to white. This is the default and is useful when you want a direct, predictable display. |
| **Log** | Gives more display space to faint intensities. Useful for revealing weak background structure, although background noise may become more visible too. |
| **Power** | Gives less display space to faint and middle intensities, emphasizing the brighter end of the range. Useful when bright features need to stand out against the background. |
| **Square root** | Brightens faint and middle intensities while retaining the original endpoints. It offers a gentler alternative to logarithmic scaling. |
| **Squared** | Darkens faint and middle intensities relative to bright ones. Useful for suppressing a faint background or concentrating on strong spokes. |
| **Asinh** | Combines approximately linear behavior near black with compressed highlights. It is useful for showing faint detail and bright detail together. |
| **Sinh** | Redistributes intensity toward smaller display values, emphasizing the brighter part of the range more strongly than linear scaling. |
| **Histogram equalization** | Redistributes intensities according to how frequently they occur in the current frame. This can improve contrast in a narrow or crowded intensity range, but it can also emphasize background differences and noise. |

### Automatic levels

- **Min / max:** Sets black level to the current frame’s minimum intensity and white level to its maximum intensity. It is a quick way to use the full display range without estimating the limits yourself.
- **ZScale:** Examines the current frame and chooses display limits that balance the background with brighter features. It is a useful starting point for astronomical images; you can fine-tune the result with the black and white sliders.

Automatic-level buttons change the black and white levels, not the selected scale mode. Choose **Linear** if you want a straightforward display after applying them.

### Resetting the display

**Reset display** restores linear scaling, zero brightness adjustment, contrast and gamma of 1, a black level of 0, and a white level of 255.

The previous/next-frame overlay can help compare adjacent images. It uses raw pixel coordinates; images are not automatically aligned.

Images are optimized for faster loading, which may slightly change displayed pixel values. Original uploaded images remain unchanged. Mask exports are not affected by these display optimizations.

Use **Download mask** to save the current binary mask. Downloaded masks use 0 for background and 255 for foreground.

## Deleted projects

Deleted projects disappear from the dashboard, and their online contents move to **Recently Deleted** for 30 days before permanent removal. Contact the person who manages the workspace promptly if you need a deleted project restored.

## Deployment and maintenance

See [DEPLOYMENT.md](DEPLOYMENT.md) for technical setup, migration, configuration, and testing instructions.
