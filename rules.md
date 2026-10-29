# Castle Clash

Castle Clash is a version of **Colonel Blotto**, a strategy game about dividing limited resources among competing objectives. Each round, you allocate soldiers to castles without seeing your opponents’ allocations. The larger army wins each castle and earns its points.

## Setup and objective

- There are **n players**, divided into **m teams**.
- Every player receives **100 soldiers at the start of each round**.
- There are **10 castles**, numbered 1 through 10. **Castle i is worth i points.**
- Each team aims to achieve the **highest total team score across all rounds**.

## How each round works

1. **Allocate your soldiers.**  
   Each player submits ten nonnegative whole numbers, representing the soldiers assigned to castles 1 through 10. These numbers must add up to exactly **100**. You may assign zero soldiers to a castle. All allocations remain hidden until everyone has submitted.

2. **Play every opposing player.**  
   Your submitted allocation is compared separately against the allocation of **every player outside your team**. The same allocation is used for all matchups in that round. At each castle:
   - If you assigned more soldiers, you earn that castle’s points.
   - If your opponent assigned more soldiers, they earn its points.
   - If you assigned equal numbers, **neither player earns any points** for that castle.

3. **Calculate individual scores.**  
   Your score for the round is the **average of the points you earned across all matchups** against players outside your team.

4. **Calculate team scores.**  
   Your team’s score for the round is the **highest individual round score among its members**. Only that score counts toward the team’s total for the round.

After the final round, add each team’s round scores together. The team with the highest total wins. Teams with equal totals share the same placing.

## Example: One matchup

Both players allocate exactly 100 soldiers:

| Castle | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Player A | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| Player B | 11 | 11 | 11 | 11 | 11 | 11 | 11 | 11 | 11 | 1 |
| Winner | B | B | B | B | B | B | B | B | B | A |

Player B wins castles 1 through 9, earning **1 + 2 + … + 9 = 45 points**. Player A wins castle 10, earning **10 points**.

**The matchup ends 45–10 in Player B’s favour.** These points contribute to each player’s individual round score.

## Example: Team scoring

If a team’s three members finish a round with individual scores of **120, 145 and 132**, the team earns **145 points** for that round.