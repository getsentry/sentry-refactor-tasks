#!/bin/bash
### Version-bumping script invoked by craft as `preReleaseCommand`.
### Located at: ./bin/bump-version.sh
###
### Craft calls this with the old and new version. The CLI reads its version
### from package.json at runtime, so bumping package.json is all that's needed.
set -eux
OLD_VERSION="${1}"
NEW_VERSION="${2}"

# Do not tag or commit changes made by "npm version"; craft owns the release commit.
export npm_config_git_tag_version=false
npm version "${NEW_VERSION}"
