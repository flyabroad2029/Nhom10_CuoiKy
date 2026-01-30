function send() {
    const input = document.getElementById("msg");
    if (!input.value.trim()) return;

    ws.send(JSON.stringify({
        type: "chat",
        msgId: Date.now() + Math.random().toString(36).slice(2),
        message: input.value,
        replyTo: replyingTo
    }));

    input.value = "";
    cancelReply();
}

function enterSend(e) {
    if (e.key === "Enter") {
        e.preventDefault();
        send();
    }
}

function addMessageUI(data) {
    const messagesBox = document.getElementById("messages");

    if (data.date !== lastDate) {
        const d = document.createElement("div");
        d.className = "date-separator";
        d.innerHTML = `<span>${data.date}</span>`;
        messagesBox.appendChild(d);
        lastDate = data.date;
    }

    const isMe = data.user === username;
    const wrapper = document.createElement("div");
    wrapper.className = `message-wrapper ${isMe ? "right" : "left"}`;
    wrapper.dataset.msgId = data.msgId;

    let replyHtml = "";
    if (data.replyTo && messages[data.replyTo]) {
        const rMsg = messages[data.replyTo];
        replyHtml = `
            <div class="reply-preview">
                <strong>${rMsg.user}</strong>: ${rMsg.message}
            </div>`;
    }

    wrapper.innerHTML = `
        <div class="message-avatar">
            <img src="${data.avatar}">
        </div>
        <div class="message-content">
            ${!isMe ? `<div class="message-header">${data.user}</div>` : ""}
            ${replyHtml}
            <div class="message">
                ${data.message}
                <div class="message-time">${data.time}</div>
                <div class="reactions"></div>
            </div>
            <div class="message-actions">
                <div class="action-btn" onclick="setReply('${data.msgId}','${data.user}','This message')">↩️</div>
                <div class="action-btn" onclick="showEmojiPicker(event,'${data.msgId}')">😀</div>
                ${isMe ? `<div class="action-btn" onclick="recallMsg('${data.msgId}')">🗑️</div>` : ""}
            </div>
        </div>
    `;

    messagesBox.appendChild(wrapper);
    wrapper.scrollIntoView({ behavior: "smooth", block: "end" });
}

function showEmojiPicker(e, msgId) {
    e.stopPropagation();
    e.preventDefault();

    const picker = document.getElementById("emojiPicker");
    const messageWrapper = e.currentTarget.closest('.message-wrapper');
    const messageContent = e.currentTarget.closest('.message-content');

    if (picker.parentElement === messageContent && picker.classList.contains('active')) {
        picker.classList.remove('active');
        messageWrapper.classList.remove('force-actions');
        return;
    }

    document.querySelectorAll('.emoji-picker.active').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.message-wrapper.force-actions').forEach(el => el.classList.remove('force-actions'));

    messageContent.appendChild(picker);
    picker.innerHTML = reactionEmojis.map(emoji => 
        `<div class="emoji-option" onclick="sendReaction('${msgId}','${emoji}')">${emoji}</div>`
    ).join("");
    
    picker.classList.add("active");
    messageWrapper.classList.add("force-actions");
}

function sendReaction(msgId, emoji) {
    ws.send(JSON.stringify({ type: "reaction", msgId, emoji }));
    addReaction(msgId, emoji);
    const picker = document.getElementById("emojiPicker");
    picker.classList.remove("active");
    const wrapper = picker.closest('.message-wrapper');
    if(wrapper) wrapper.classList.remove('force-actions');
}

document.addEventListener('click', (e) => {
    const picker = document.getElementById("emojiPicker");
    if (!e.target.closest('.action-btn') && !e.target.closest('.emoji-picker')) {
        if(picker.classList.contains('active')) {
            picker.classList.remove('active');
            const wrapper = picker.closest('.message-wrapper');
            if(wrapper) wrapper.classList.remove('force-actions');
        }
    }
});

function addReaction(msgId, emoji) {
    const box = document.querySelector(`[data-msg-id="${msgId}"] .reactions`);
    if (!box) return;
    let item = box.querySelector(`[data-emoji="${emoji}"]`);
    if (item) {
        let count = parseInt(item.querySelector("span").textContent);
        item.querySelector("span").textContent = count + 1;
    } else {
        box.innerHTML += `<div class="reaction-item" data-emoji="${emoji}">${emoji} <span>1</span></div>`;
    }
}

function updateUsers(users) {
    document.getElementById("onlineCount").textContent = users.length;
    document.getElementById("userList").innerHTML = users.map(u => {
        const isMe = u.user === username;
        return `
            <div class="user-item ${isMe ? 'me' : ''}">
                <div class="user-avatar"><img src="${u.avatar}"></div>
                <div class="user-name">${u.user} ${isMe ? `<span class="you-label">(Bạn)</span>` : ""}</div>
                <div class="user-status"></div>
            </div>`;
    }).join("");
}

function setReply(id, user) {
    replyingTo = id;
    document.getElementById("replyBar").classList.add("active");
    document.getElementById("replyToUser").textContent = user;
    document.getElementById("replyToText").textContent = messages[id]?.message || "";
}

function cancelReply() {
    replyingTo = null;
    document.getElementById("replyBar").classList.remove("active");
}

function recallMsg(msgId) {
    if (confirm("Bạn muốn thu hồi tin nhắn này?")) {
        ws.send(JSON.stringify({ type: "recall", msgId }));
    }
}

function recallMessage(msgId) {
    const msgWrapper = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (!msgWrapper) return;
    const msgDiv = msgWrapper.querySelector('.message');
    msgDiv.innerHTML = "<i>Tin nhắn đã bị thu hồi</i>";
    msgDiv.classList.add("recalled");
    const actions = msgWrapper.querySelector('.message-actions');
    if (actions) actions.remove();
}

function addSystem(text) {
    const d = document.createElement("div");
    d.className = "system-message";
    d.textContent = text;
    document.getElementById("messages").appendChild(d);
}

async function startCall() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('videoContainer').style.display = 'flex';
        document.getElementById('localVideo').srcObject = localStream;
        isMicOn = true;
        isCamOn = true;
        updateMediaButtons();
        ws.send(JSON.stringify({ type: "call_signal", action: "request" }));
    } catch (err) {
        alert("Lỗi Camera/Mic: " + err);
    }
}

async function acceptCall() {
    document.getElementById('callPopup').style.display = 'none';
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('videoContainer').style.display = 'flex';
        document.getElementById('localVideo').srcObject = localStream;
        updateMediaButtons();
        addSystem("Bạn đã tham gia cuộc gọi.");
    } catch (err) {
        alert("Lỗi: " + err);
    }
}

function endCall() {
    endCallUI();
}

function endCallUI() {
    if(localStream) localStream.getTracks().forEach(t => t.stop());
    document.getElementById('videoContainer').style.display = 'none';
    document.getElementById('callPopup').style.display = 'none';
}

function rejectCall() {
    document.getElementById('callPopup').style.display = 'none';
    ws.send(JSON.stringify({ type: "call_signal", action: "reject" }));
}

function toggleMic() {
    if (!localStream) return;
    isMicOn = !isMicOn;
    localStream.getAudioTracks().forEach(t => t.enabled = isMicOn);
    updateMediaButtons();
}

function toggleCam() {
    if (!localStream) return;
    isCamOn = !isCamOn;
    localStream.getVideoTracks().forEach(t => t.enabled = isCamOn);
    updateMediaButtons();
}

function updateMediaButtons() {
    const mBtn = document.getElementById('toggleMic');
    const cBtn = document.getElementById('toggleCam');
    if(mBtn) {
        mBtn.textContent = isMicOn ? "🎙️ Mic: Bật" : "🔇 Mic: Tắt";
        mBtn.style.background = isMicOn ? "#444" : "#e74c3c";
    }
    if(cBtn) {
        cBtn.textContent = isCamOn ? "📷 Cam: Bật" : "🚫 Cam: Tắt";
        cBtn.style.background = isCamOn ? "#444" : "#e74c3c";
    }
}
