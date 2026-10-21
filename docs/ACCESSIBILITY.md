# Accessibility

A Cast receiver shows on a TV and takes no input of its own. The viewer
controls it from a sender: a phone, a computer or a TV remote. The
sender's controls are where most barriers are, so check the sender too.
[`@mattebox/player-cast`](https://github.com/jboix/mattebox-player) is the
Mattebox sender.

The receiver aims to meet [WCAG 2.2](https://www.w3.org/TR/WCAG22/) at
level AA for what it shows. Nobody has audited it by hand, so this is a
goal, not a claim of conformance.

## What the receiver does

- It reports every audio and text track to the sender, so the sender can list and select them.
- It marks caption tracks (subtitles for the deaf and hard of hearing, CEA-608 and CEA-708) with the Cast subtype `CAPTIONS`.
- It shows the sender's own subtitles as text tracks on the video.
- It leaves forced subtitles out of the list. The engine shows them while no other subtitle is selected.
- The playground's form fields have names, and its status line is a live region.

## How it is checked

- axe-core checks the receiver page for WCAG 2.0, 2.1 and 2.2 A and AA, while it plays and on the idle screen, in Chromium, Firefox and WebKit.
- axe-core checks the playground's page in the light and the dark scheme, as it loads and with its content dialog open, in Chromium.
- Browser tests check the track list a sender receives, with its ids and kinds.
- Biome's accessibility lint rules run on the code.

## Known limitations

- axe-core finds part of the WCAG issues, about 57% by its maker Deque's count. The rest needs a review by hand, which has not been done.
- The receiver does not tell the sender that an audio track is an audio description: it sets no `roles` on the Cast track.
- The receiver does not apply the caption style a sender sends (`textTrackStyle`).
- The receiver does not announce anything with the TV's screen reader. It has not been tested with TalkBack on Google TV.
- The idle screen and the player's look are your receiver page's CSS. Their contrast is yours to check.

## Report a barrier

[Open an accessibility issue](https://github.com/jboix/mattebox-receiver/issues/new?template=03_accessibility.yml)
and say what stopped you, with which Cast device, sender and assistive
technology. Every report is read. There is no fixed timeline for a fix.
