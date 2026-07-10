# Installing Popup Zapper on your phone

Popup Zapper is the same script on every device. Phones run it through a
browser that supports userscripts.

## Android (recommended: Firefox + Violentmonkey)

1. Install **Firefox** from the Play Store.
2. In Firefox, install **Violentmonkey** from addons.mozilla.org.
3. Open the raw script link and tap **Confirm installation**:
   https://raw.githubusercontent.com/EJR-of-Scrutopia/popup-zapper/master/dist/popup-zapper.user.js
4. Updates arrive automatically, exactly like desktop.

## iPhone (Safari + the free Userscripts app)

1. Install **Userscripts** (by quoid) from the App Store.
2. Open **Settings > Apps > Safari > Extensions > Userscripts** and enable it,
   then allow it on **All Websites**.
3. Open the Userscripts app once so it finishes setup.
4. Add the script: open the raw link above in Safari and import it through the
   Userscripts extension (tap the puzzle-piece / Userscripts icon in the Safari
   toolbar).
5. **Updating on iPhone is semi-manual.** When a new version exists, open
   Popup Zapper > Settings > **Copy update link**, then re-import that link in
   the Userscripts app. (Safari cannot auto-install like Tampermonkey does.)

## Device smoke checklist (run after installing)

- [ ] Badge appears bottom-right and clears the browser toolbar/notch.
- [ ] Tapping the badge opens the menu; items are comfortably tappable.
- [ ] Block a popup: the picker toolbar cycles candidates by tap and blocks one.
- [ ] Remove paywall / Revert last block work.
- [ ] Toggle a site off then on.
- [ ] Change Appearance (Auto/Light/Dark) and see it repaint.
- [ ] Reload the page: your rules and theme persist (proves async storage).
- [ ] iPhone only: Settings > Copy update link copies the raw URL.