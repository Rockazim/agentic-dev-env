# Agentic Dev Environment

A project-based, multi-agent development environment built around parallel AI chats inside the same repo.

## Overview

This project is a desktop app for working with multiple AI coding chats inside one project.

Instead of one assistant panel, each project can have multiple chats open at the same time. For example, one chat could debug an issue, another could refactor code, another could write docs, and another could investigate a deployment problem.

Each chat is chat-first, but it can use CLI tools when needed.

The goal is not to recreate VS Code.

The goal is to create a better environment for managing multiple AI coding agents inside one repo.

## Core Idea

* each tab is a project
* each project can have multiple chats open at once
* one tab could have 4 chats open in a grid
* chats share the same repo context
* each chat has its own conversation history
* chats can use CLI tools when needed
* support providers like Claude Code and Codex
* include voice typing
* include git integration

## Example

Inside a project tab called `skinmerge`, you might have 4 chats open:

1. debug pricing bug
2. refactor trade-up filters
3. write docs
4. investigate deployment issue

All 4 chats work inside the same repo, but each has its own conversation.

## What This App Should Do

* open projects as tabs
* let each project have multiple chats
* let each chat use Claude Code or Codex
* let chats run CLI actions when needed
* show terminal output when tools run
* keep chat history saved
* support voice typing into the focused chat
* support git actions and git awareness

## Git Integration

Git should be part of the core workflow.

That includes things like:

* seeing current branch
* seeing changed files
* viewing diffs
* staging changes
* committing changes
* understanding which chat made which changes

## MVP

The first version should have:

* project tabs
* multiple chats per project
* 2x2 or similar chat grid layout
* provider selector per chat
* Claude Code support
* Codex support
* CLI/tool execution from chats
* visible terminal output
* persistent chat history
* voice typing
* git integration
* basic diff viewing
* apply or reject changes

## UX

A simple layout could be:

* sidebar for projects
* main area for chat grid
* each chat has its own thread and input
* terminal output can show inline or in a panel
* git state and file changes should be visible

## Why This Exists

Most coding tools either:

* focus on one assistant inside an IDE
* or focus on the terminal itself

This project is aiming for something else:

multiple AI chats inside one project, with tool access, repo awareness, and git integration.

## Summary

This is a multi-agent coding workspace where each project tab can contain multiple AI chats working in parallel inside the same repo.

The main interface is chat-first, with CLI access, voice typing, and git integration built in.
