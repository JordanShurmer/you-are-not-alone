# You are note alone

This is a web-based 2d terraria-style multi-player quick-join video game.

You are a member of a society being accosted by dragons. You must build your village, love your family, meet other players, and save the day.


# Game Premise

- a stylisting village-building and dragon-fighting game
  - style is whimsical hand draw (pngs from midjourney: --sref 658225328 1389363564)

- things are quite dark, but you carry a lightsource that lets you see. multiple players give wider light

- co-op is needed for real progress
- tinkering, farming, and aesthetic improvements can happen when solo


# Architecture

- everything is an entity in a giant array (so-called "fat struct")
- game loop inspects properties and behaves accordingly
  - e.g. if it has .image = {..} then it renders it. if it has .lightsource then it uses that as a light source. if it has a .box then it handles collision detection

- do simple in-js memory optimizations, knowing we're computing things entire frame at a time and not longer
- do simple in-js cpu optimizations, knowing we're computing thigs entire frame at a time

- a queue of "actions" provides a uniform input into the game, including user input, network activity (i.e. multiplayer), etc.

- use pixijs for rendering
