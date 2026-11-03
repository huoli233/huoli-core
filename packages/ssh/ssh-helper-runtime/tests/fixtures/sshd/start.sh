#!/bin/sh
set -eu
ssh-keygen -q -t ed25519 -N '' -f /etc/ssh/ssh_host_ed25519_key
install -d -m 700 -o huoli -g huoli /home/huoli/.ssh
install -m 600 -o huoli -g huoli /fixture-key.pub /home/huoli/.ssh/authorized_keys
install -d -m 700 -o huoli -g huoli /home/huoli/workspace
exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config
