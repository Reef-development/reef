#!/usr/bin/env bash

set -euo pipefail

REPO="Reef-development/reef"

GH_BRADLEY="RwafaBradley"
GH_LEO="VanNiekerkJoe"
GH_TAYLER="UsmarTayler"
GH_TSHEPO="Kau-Tshepo"
GH_TLAMELO="MothupiTlamelo"

PROJECT_TITLE="REEF completion"

CSV="docs/board_tasks.csv"

if [ ! -f "$CSV" ]; then
echo "Cannot find $CSV. Save it first, then run this again."
exit 1
fi

OWNER="${REPO%%/*}"

echo "Creating the project board..."
gh project create --owner "$OWNER" --title "$PROJECT_TITLE"

PROJECT_NUMBER="1"
PROJECT_URL="https://github.com/orgs/Reef-development/projects/$PROJECT_NUMBER"

echo "Using project: $PROJECT_URL"

echo "Making sure the stage labels exist..."

gh label create "stage:repository" --repo "$REPO" --color BFD4D1 --force >/dev/null
gh label create "stage:gaps" --repo "$REPO" --color BFD4D1 --force >/dev/null
gh label create "stage:tests" --repo "$REPO" --color BFD4D1 --force >/dev/null
gh label create "stage:documents" --repo "$REPO" --color BFD4D1 --force >/dev/null
gh label create "stage:live" --repo "$REPO" --color BFD4D1 --force >/dev/null

gh_user_for() {

case "$1" in

Bradley) echo "$GH_BRADLEY" ;;

Leo) echo "$GH_LEO" ;;

Tayler) echo "$GH_TAYLER" ;;

Tshepo) echo "$GH_TSHEPO" ;;

Tlamelo) echo "$GH_TLAMELO" ;;

*) echo "" ;;

esac

}

tail -n +2 "$CSV" | sed 's/\r$//' | while IFS='|' read -r id title owner checker days day after stage; do

[ -z "${id//[[:space:]]/}" ] && continue

assignee="$(gh_user_for "$owner")"

body="Owner: ${owner}

Checked by: ${checker}

Estimate: ${days} day(s)

Starts: ${day}

Waits for: ${after}

The full task, with what to do and the tick boxes, is in the task sheet PDF in

docs/task_sheets/. Put \"Closes #<this issue number>\" in your pull request and

this card closes itself when Bradley merges."

echo "Creating ${id} ${title}"

ISSUE_URL="$(gh issue create --repo "$REPO" \
--title "${id} ${title}" \
--body "$body" \
--label "stage:${stage}" \
${assignee:+--assignee "$assignee"})"

gh project item-add "${PROJECT_URL##*/}" --owner "$OWNER" --url "$ISSUE_URL" >/dev/null

done

echo

echo "Done. Open $PROJECT_URL"

echo "Set the board grouping to the stage label, and you have your five columns."
