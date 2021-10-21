#!/bin/bash 

javadoc  --include "**/*.js" "**/*.ts"  --exclude "**/node_modules/**" "**ignore**"  --format markdown  --output JDOC.md

