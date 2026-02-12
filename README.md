# amq_scripts

### amqPlusConnector.user.js
A bridge script that connects AMQ (Anime Music Quiz) to [AMQ+](https://github.com/4Lajf/amq-plus) quiz configurations for seamless quiz playing
- Fetch and play quizzes directly from AMQ+ website by pasting play URLs
- Automatically syncs player lists from lobby for Live Node quizzes
- Export AMQ quizzes to AMQ+ import format from the quiz creator
- Train on any pool of songs using the website quiz creator and the training mode.

---

### amqBuzzerGamemodeV2.js
A competitive buzzer-style gamemode for Anime Music Quiz where players race to recognize songs first by pressing a buzzer key to mute the audio, then typing their answer.
- **Scoring**: Points = placement per round (1st=5, 2nd=3, 3rd=2, 4th=1) + speed bonus (based on buzz time, max +1.0 for ≤500ms)
- **Leaderboards**: Host can toggle per-round fastest leaderboard in chat; final results posted at quiz end
- **Commands**: `/buzzer` to configure key, `/buzzerround` to toggle leaderboard, `/buzzertime <seconds>` to set time limit

---

### amqBetterSongArtist.user.js (Under Rebuild)
An improved version of [Zolhungaj]'s(https://github.com/amq-script-project) [amqSongArtist](https://github.com/amq-script-project/AMQ-Scripts/blob/master/gameplay/amqSongArtistMode.user.js)~~
- Guess the anime song by title or aritst
- Has AMQ-like dropdown (auto-updating, hilighting matches, ignoring special characters, supports partial searching, navigateable with arrows etc.)
- And a leaderboard when you can track scores in place of the existing one
- AND TWO score modes! One is the original and the other one allows you to enter only one of the performing artists allowing for an easier playthrough.
- Some popular titles may not be there because they weren't in the expand library too. You can let me know by creating an issue in this github repo. Make sure to respond to your issue if you find more missing titles instead of creating a new one everytime.

---
### amqAnswerTimeDiference.js
A fork of [Zolhungaj]'s(https://github.com/amq-script-project) [amqPlayerAnswerTimeDisplay](https://github.com/amq-script-project/AMQ-Scripts/blob/master/gameplay/amqPlayerAnswerTimeDisplay.user.js)
- See the diference in answering time to the fastest player, updates dynamicly
- See how fast you were on a per round basis (round leaderboard)
- See how much time you spent answering questions (after-quiz leaderboard)
- See in which round people gave fastest answers (after-quiz leaderboard)
- Settings for toggling diferent parts of the script (can be found where normal settings would be)
And decide to either send those stats to yourself only or to the entire chat. The settings for this script can be found where the usual settings are.
---

### amqTiebreakPoints.user.js
- Awards additional tiebreak points (on the right side of your score in leaderboard) if you are the fastest one to get the answer right. This script is meant to serve as a way to tiebreak places.

---
### amqHotkeyFunctions.js
- Slightly altered Hotkey Functions plugin to nicely work with multiple input boxes on Song Artist mode

---

### Shoutout to Zol, Joseph and Ayuu, their code helped me to write the things above.
--- 

## Obsolete becuase of amqplus.moe

### amqTrainingMode.user.js
Extended version of [kempanator](https://github.com/kempanator)'s[Custom Song List Game](https://github.com/kempanator/amq-scripts/blob/main/amqCustomSongListGame.user.js)
- Training mode allows you to practice your songs efficiently something line anki or other memory card software. It's goal is to give you songs that you don't recozniged mixed with some songs that you do recognize to solidify them in your memory.
