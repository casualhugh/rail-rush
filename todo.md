[ ] Mark challenge complete gives an error 
ReferenceError: _completeChallengeAndDraw is not defined at C:\Users\Hughe\Documents\projects\rail-rush\backend\pb.js:34:28(164)

[ ] Same with mark failed
ReferenceError: _clearChallengeFromStation is not defined at C:\Users\Hughe\Documents\projects\rail-rush\backend\pb.js:19:29(98)

[ ] Events feed disapears on refresh looks like its not fetching the events feed from the backend on load

[ ] From the lay over they say that challenges get more points the longer the game goes might need an increment points percentage as challenges get completed? 

[ ] Host has to approve themselves onto a team that seems a bit silly should just auto approve

[ ] unsure of the logic behind failing a challenge it should increase the coins earned by completing it and make it so that the team that failed it cannot reattempt until the other team does 

[ ] Might also need to add a "Mark impossible" (only available to the host) so that it clears a challenge that cannot be completed

[ ] no logic around when a team can look at a challenge ie team needs to be near it to view it 

[ ] Need to add the station finding using a polygon tool like is in the design doc so map creation is easier 

[ ] Need to add logic for "passing through stations" to ensure that if you claim a station you have a connection to it ie own one next to it? or do we keep it on a trust based system